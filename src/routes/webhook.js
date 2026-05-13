const express = require('express');
const router = express.Router();
const { findOrCreateUser, setUserName } = require('../services/userService');
const { addTransaction, addTransactionDirect, getMonthlyReport } = require('../services/transactionService');
const { parseBudgetCommand, isDeleteLastCommand, setBudget, getBudgets, checkBudgetAlert, deleteLastTransaction } = require('../services/budgetService');
const {
  DEFAULT_CATEGORIES,
  addFixedTransaction,
  getFixedTransactions,
  deleteFixedTransaction,
  getUserCategories,
  addCustomCategory,
} = require('../services/fixedTransactionService');
const { sendWhatsApp } = require('../services/twilioService');

// userState[phone] = 'awaiting_name' | { action: 'awaiting_category', amount, type, description }
const userState = {};

router.post('/', async (req, res) => {
  const from = req.body.From?.replace('whatsapp:', '');
  const body = req.body.Body?.trim();

  if (!from || !body) return res.sendStatus(400);

  const user = await findOrCreateUser(from);
  const lower = body.toLowerCase();
  let reply = '';

  // ── שלב 1: משתמש חדש - בקשת שם ──
  if (!user.name && userState[from] !== 'awaiting_name') {
    userState[from] = 'awaiting_name';
    reply = `היי! 👋 ברוך הבא ל-Budget Bot! 🤖💰\n\nאני הבוט החכם שיעזור לך לנהל את הכסף שלך בקלות - ישירות מוואטסאפ!\n\nרק תגיד לי מה קנית, מה קיבלת - ואני אדאג לכל השאר 😊\n\nאז בוא נתחיל... מה שמך?`;

  // ── שלב 2: קבלת שם ──
  } else if (userState[from] === 'awaiting_name') {
    await setUserName(from, body);
    delete userState[from];
    reply = `כיף להכיר אותך ${body}! 🎉\n\nאני מוכן לעבוד בשבילך. הנה מה שאני יכול:\n\n💸 *הוצאה:* "קפה 15" / "סופר 200"\n💰 *הכנסה:* "קיבלתי 500 מתנה"\n📊 *דוח חודשי:* שלח "דוח"\n🔁 *הוצאה קבועה:* "הוצאה קבועה שכ׳׳ד 3500"\n🎯 *תקציב לקטגוריה:* "הגדר תקציב אוכל 1000"\n❓ *עזרה:* שלח "עזרה"\n\nמה ההוצאה הראשונה שלך? 😄`;

  // ── שלב 3: ממתין לבחירת קטגוריה ──
  } else if (userState[from] && typeof userState[from] === 'object' && userState[from].action === 'awaiting_category') {
    const pending = userState[from];
    delete userState[from];

    const allCats = await getUserCategories(user.id);

    let chosenCategory = null;
    const numMatch = body.match(/^(\d+)$/);
    if (numMatch) {
      const idx = parseInt(numMatch[1]) - 1;
      if (idx >= 0 && idx < allCats.length) chosenCategory = allCats[idx];
    }
    if (!chosenCategory) {
      chosenCategory = allCats.find(c => c === body.trim()) || body.trim();
    }

    await addTransactionDirect(user.id, pending.amount, pending.type, chosenCategory, pending.description);

    reply = `✅ נרשמה הוצאה!\n\n💸 ${pending.amount}₪\n📂 קטגוריה: ${chosenCategory}`;

    const alert = await checkBudgetAlert(user.id, chosenCategory);
    if (alert) {
      if (alert.type === 'exceeded') {
        reply += `\n\n🔴 חרגת מהתקציב ל${alert.category}!\nהוצאת ${alert.spent.toFixed(0)}₪ מתוך ${alert.limit}₪`;
      } else {
        reply += `\n\n🟡 שימו לב: ${alert.percent}% מהתקציב ל${alert.category} (${alert.spent.toFixed(0)}/${alert.limit}₪)`;
      }
    }

  // ── פקודות ──

  } else if (lower === 'דוח' || lower === 'סיכום') {
    const report = await getMonthlyReport(user.id);
    const budgets = await getBudgets(user.id);
    reply = await formatReport(report, budgets);

  } else if (lower === 'תקציב' || lower === 'תקציבים') {
    const budgets = await getBudgets(user.id);
    if (budgets.length === 0) {
      reply = `לא הגדרת תקציבים עדיין.\n\nכדי להגדיר:\n"הגדר תקציב אוכל 1000"\n"הגדר תקציב תחבורה 500"`;
    } else {
      const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
      const transactions = await require('../db').transaction.findMany({
        where: { userId: user.id, type: 'expense', date: { gte: start } },
      }).catch(() => []);
      const byCategory = {};
      for (const t of transactions) byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;

      const lines = ['📋 התקציבים שלך החודש:\n'];
      for (const b of budgets) {
        const spent = byCategory[b.name] || 0;
        const pct = Math.round((spent / b.budgetLimit) * 100);
        const bar = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
        lines.push(`${bar} ${b.name}: ${spent.toFixed(0)}/${b.budgetLimit}₪ (${pct}%)`);
      }
      lines.push(`\nלשנות: "הגדר תקציב [קטגוריה] [סכום]"`);
      reply = lines.join('\n');
    }

  } else if (lower.startsWith('הגדר תקציב')) {
    const parsed = parseBudgetCommand(body);
    if (parsed) {
      await setBudget(user.id, parsed.category, parsed.limit);
      reply = `✅ הגדרתי תקציב של ${parsed.limit}₪ לחודש עבור "${parsed.category}" 🎯\n\nאתריע לך כשתגיע ל-80% 😊`;
    } else {
      reply = `לא הבנתי. נסה:\n"הגדר תקציב אוכל 1000"`;
    }

  // ── הוצאות/הכנסות קבועות ──

  } else if (lower.startsWith('הוצאה קבועה') || lower.startsWith('הכנסה קבועה')) {
    const result = await addFixedTransaction(user.id, body);
    if (result) {
      const { parsed } = result;
      const icon = parsed.type === 'income' ? '💰' : '💸';
      const label = parsed.type === 'income' ? 'הכנסה קבועה' : 'הוצאה קבועה';
      reply = `✅ נוסף! ${icon}\n\n${label}: ${parsed.description}\nסכום: ${parsed.amount}₪\nקטגוריה: ${parsed.category}\n\nתירשם אוטומטית ב-1 לכל חודש 🔄`;
    } else {
      reply = `לא הבנתי. נסה:\n"הוצאה קבועה שכ"ד 3500"\n"הוצאה קבועה הלוואה 1200"\n"הכנסה קבועה משכורת 8000"`;
    }

  } else if (lower === 'הוצאות קבועות') {
    const items = await getFixedTransactions(user.id, 'expense');
    if (items.length === 0) {
      reply = `אין הוצאות קבועות.\n\nכדי להוסיף:\n"הוצאה קבועה שכ"ד 3500"`;
    } else {
      const total = items.reduce((s, i) => s + i.amount, 0);
      const lines = ['💸 *הוצאות קבועות חודשיות:*\n'];
      items.forEach((item, i) => lines.push(`${i + 1}. ${item.description}: ${item.amount}₪ (${item.category})`));
      lines.push(`\nסה"כ: ${total}₪ לחודש`);
      lines.push(`\nלמחיקה: "מחק הוצאה קבועה 1"`);
      reply = lines.join('\n');
    }

  } else if (lower === 'הכנסות קבועות') {
    const items = await getFixedTransactions(user.id, 'income');
    if (items.length === 0) {
      reply = `אין הכנסות קבועות.\n\nכדי להוסיף:\n"הכנסה קבועה משכורת 8000"`;
    } else {
      const total = items.reduce((s, i) => s + i.amount, 0);
      const lines = ['💰 *הכנסות קבועות חודשיות:*\n'];
      items.forEach((item, i) => lines.push(`${i + 1}. ${item.description}: ${item.amount}₪`));
      lines.push(`\nסה"כ: ${total}₪ לחודש`);
      lines.push(`\nלמחיקה: "מחק הכנסה קבועה 1"`);
      reply = lines.join('\n');
    }

  } else if (/מחק הוצאה קבועה/.test(lower)) {
    const numMatch = lower.match(/מחק הוצאה קבועה\s*(\d+)/);
    if (numMatch) {
      const deleted = await deleteFixedTransaction(user.id, 'expense', parseInt(numMatch[1]));
      reply = deleted
        ? `🗑️ נמחקה הוצאה קבועה:\n${deleted.description} - ${deleted.amount}₪`
        : `לא נמצאה הוצאה קבועה במספר זה. שלח "הוצאות קבועות" לרשימה.`;
    } else {
      reply = `שלח "מחק הוצאה קבועה 1" עם המספר מהרשימה.`;
    }

  } else if (/מחק הכנסה קבועה/.test(lower)) {
    const numMatch = lower.match(/מחק הכנסה קבועה\s*(\d+)/);
    if (numMatch) {
      const deleted = await deleteFixedTransaction(user.id, 'income', parseInt(numMatch[1]));
      reply = deleted
        ? `🗑️ נמחקה הכנסה קבועה:\n${deleted.description} - ${deleted.amount}₪`
        : `לא נמצאה הכנסה קבועה במספר זה. שלח "הכנסות קבועות" לרשימה.`;
    } else {
      reply = `שלח "מחק הכנסה קבועה 1" עם המספר מהרשימה.`;
    }

  // ── קטגוריות ──

  } else if (lower === 'קטגוריות') {
    const allCats = await getUserCategories(user.id);
    const budgets = await getBudgets(user.id);
    const budgetMap = {};
    for (const b of budgets) budgetMap[b.name] = b.budgetLimit;

    const lines = ['📂 *הקטגוריות שלך:*\n'];
    allCats.forEach((cat, i) => {
      const budget = budgetMap[cat] ? ` (תקציב: ${budgetMap[cat]}₪)` : '';
      lines.push(`${i + 1}. ${cat}${budget}`);
    });
    lines.push(`\nלהוסיף קטגוריה: "הוסף קטגוריה ספורט"`);
    reply = lines.join('\n');

  } else if (lower.startsWith('הוסף קטגוריה')) {
    const catName = body.replace(/הוסף קטגוריה/i, '').trim();
    if (catName) {
      const added = await addCustomCategory(user.id, catName);
      reply = added
        ? `✅ קטגוריה "${catName}" נוספה!\nעכשיו תוכל להשתמש בה לרישום הוצאות ותקציב.`
        : `הקטגוריה "${catName}" כבר קיימת.`;
    } else {
      reply = `שלח "הוסף קטגוריה [שם]"\nלדוגמה: "הוסף קטגוריה ספורט"`;
    }

  // ── מחיקת עסקה אחרונה ──

  } else if (isDeleteLastCommand(lower)) {
    const deleted = await deleteLastTransaction(user.id);
    reply = deleted
      ? `🗑️ נמחקה ההוצאה האחרונה:\n${deleted.category} - ${deleted.amount}₪`
      : `לא נמצאו עסקאות למחיקה.`;

  // ── עזרה ──

  } else if (lower === 'עזרה') {
    reply = `היי ${user.name || ''}! הנה כל מה שאני יודע 😊\n\n💸 *הוצאה:*\n"קפה 15" / "סופר 200" / "30 סיגריות"\n\n💰 *הכנסה:*\n"קיבלתי 500 מתנה"\n\n🔁 *קבועים (נרשמים ב-1 לחודש):*\n"הוצאה קבועה שכ"ד 3500"\n"הכנסה קבועה משכורת 8000"\n"הוצאות קבועות" / "הכנסות קבועות"\n\n📊 "דוח" - סיכום חודשי\n🎯 "תקציב" - מצב תקציבים\n⚙️ "הגדר תקציב אוכל 1000"\n📂 "קטגוריות" / "הוסף קטגוריה ספורט"\n🗑️ "מחק הוצאה אחרונה"\n🌐 "לינק" - דשבורד אישי\n\n📅 כל ראשון תקבל דוח שבועי עם חיזוק!`;

  } else if (lower === 'לינק' || lower === 'דשבורד') {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    reply = `הדשבורד האישי שלך:\n${baseUrl}/dashboard?token=${user.dashboardToken}`;

  // ── פרסור חכם של עסקה ──

  } else {
    const result = await addTransaction(user.id, body);
    if (result) {
      const { parsed, transaction } = result;

      if (!parsed.isConfident) {
        // לא בטוח בקטגוריה → שואל משתמש
        const allCats = await getUserCategories(user.id);
        userState[from] = {
          action: 'awaiting_category',
          amount: parsed.amount,
          type: parsed.type,
          description: parsed.description,
        };
        // מוחק את העסקה שנשמרה כי עוד לא יודעים קטגוריה
        await require('../db').transaction.delete({ where: { id: transaction.id } });

        const catList = allCats.map((c, i) => `${i + 1}. ${c}`).join('\n');
        reply = `הבנתי שהוצאת ${parsed.amount}₪ 🤔\n"${parsed.description}" - לאיזה קטגוריה לשייך?\n\n${catList}\n\nשלח מספר או שם קטגוריה 😊`;
      } else {
        const emoji = parsed.type === 'expense' ? '💸' : '💰';
        const typeText = parsed.type === 'expense' ? 'הוצאה' : 'הכנסה';
        reply = `${emoji} נרשמה ${typeText}!\n\n${parsed.amount}₪ | ${parsed.category}${parsed.description ? `\n📝 ${parsed.description}` : ''}`;

        if (parsed.type === 'expense') {
          const alert = await checkBudgetAlert(user.id, parsed.category);
          if (alert) {
            if (alert.type === 'exceeded') {
              reply += `\n\n🔴 חרגת מהתקציב ל${alert.category}!\nהוצאת ${alert.spent.toFixed(0)}₪ מתוך ${alert.limit}₪`;
            } else {
              reply += `\n\n🟡 שימו לב: ${alert.percent}% מהתקציב ל${alert.category} (${alert.spent.toFixed(0)}/${alert.limit}₪)`;
            }
          }
        }
      }
    } else {
      reply = `אופס, לא הצלחתי להבין 😅\n\nנסה:\n• "קפה 15"\n• "סופר 200"\n• "קיבלתי 500 מתנה"\n\nאו שלח "עזרה" לרשימה מלאה 😊`;
    }
  }

  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`);
});

async function formatReport(report, budgets) {
  const lines = [
    `📊 סיכום חודשי\n`,
    `💰 הכנסות: ${report.totalIncome.toFixed(0)}₪`,
    `💸 הוצאות: ${report.totalExpenses.toFixed(0)}₪`,
    `📈 יתרה: ${report.balance.toFixed(0)}₪\n`,
    `הוצאות לפי קטגוריה:`,
  ];

  for (const [cat, amount] of Object.entries(report.byCategory)) {
    const budget = budgets.find(b => b.name === cat);
    if (budget) {
      const pct = Math.round((amount / budget.budgetLimit) * 100);
      const bar = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
      lines.push(`  ${bar} ${cat}: ${amount.toFixed(0)}/${budget.budgetLimit}₪`);
    } else {
      lines.push(`  • ${cat}: ${amount.toFixed(0)}₪`);
    }
  }

  return lines.join('\n');
}

module.exports = router;
