const express = require('express');
const router = express.Router();
const { findOrCreateUser, setUserName } = require('../services/userService');
const { addTransaction, getMonthlyReport } = require('../services/transactionService');
const { parseBudgetCommand, isDeleteLastCommand, setBudget, getBudgets, checkBudgetAlert, deleteLastTransaction } = require('../services/budgetService');
const { sendWhatsApp } = require('../services/twilioService');

const userState = {};

router.post('/', async (req, res) => {
  const from = req.body.From?.replace('whatsapp:', '');
  const body = req.body.Body?.trim();

  if (!from || !body) return res.sendStatus(400);

  const user = await findOrCreateUser(from);
  const lower = body.toLowerCase();
  let reply = '';

  if (!user.name && userState[from] !== 'awaiting_name') {
    userState[from] = 'awaiting_name';
    reply = `היי! 👋 ברוך הבא ל-Budget Bot! 🤖💰\n\nאני הבוט החכם שיעזור לך לנהל את הכסף שלך בקלות - ישירות מוואטסאפ, בלי אפליקציות מסובכות!\n\nרק תגיד לי מה קנית, מה קיבלת - ואני אדאג לכל השאר 😊\n\nאז בוא נתחיל... מה שמך?`;

  } else if (userState[from] === 'awaiting_name') {
    await setUserName(from, body);
    delete userState[from];
    reply = `כיף להכיר אותך ${body}! 🎉\n\nאני כבר מוכן לעבוד בשבילך. הנה מה שאני יכול לעשות:\n\n💸 *להוציא הוצאה:*\n"קניתי קפה ב-15 שקל"\n"שילמתי דלק 200 שקל"\n\n💰 *לרשום הכנסה:*\n"קיבלתי משכורת 8000 שקל"\n\n📊 *לראות סיכום:* שלח "דוח"\n🎯 *לקבוע תקציב:* "הגדר תקציב אוכל 1000"\n❓ *עזרה:* שלח "עזרה"\n\nאז.. מה הייתה ההוצאה הראשונה שלך היום? 😄`;

  } else if (lower === 'דוח' || lower === 'סיכום') {
    const report = await getMonthlyReport(user.id);
    const budgets = await getBudgets(user.id);
    reply = await formatReport(report, budgets);

  } else if (lower === 'תקציב' || lower === 'תקציבים') {
    const budgets = await getBudgets(user.id);
    if (budgets.length === 0) {
      reply = `לא הגדרת תקציבים עדיין.\n\nכדי להגדיר שלח:\n"הגדר תקציב אוכל 1000"\n"הגדר תקציב תחבורה 500"`;
    } else {
      const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
      const transactions = await require('../db').transaction.findMany({ where: { userId: user.id, type: 'expense', date: { gte: start } } }).catch(() => []);
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
      reply = `✅ סבבה ${user.name || ''}! הגדרתי לך תקציב של ${parsed.limit}₪ לחודש עבור "${parsed.category}" 🎯\n\nאתריע לך כשתגיע ל-80% - ואם תחרוג, תדע מייד 😊`;
    } else {
      reply = `לא הבנתי. נסה:\n"הגדר תקציב אוכל 1000"`;
    }

  } else if (isDeleteLastCommand(lower)) {
    const deleted = await deleteLastTransaction(user.id);
    if (deleted) {
      reply = `🗑️ נמחקה ההוצאה האחרונה:\n${deleted.category} - ${deleted.amount}₪`;
    } else {
      reply = `לא נמצאו הוצאות למחיקה.`;
    }

  } else if (lower === 'עזרה') {
    reply = `פקודות זמינות:\n\n💸 הוצאה: "קניתי/שילמתי X שקל"\n💰 הכנסה: "קיבלתי/נכנס לי X שקל"\n📊 דוח חודשי: "דוח"\n📋 תקציבים: "תקציב"\n⚙️ הגדרת תקציב: "הגדר תקציב אוכל 1000"\n🗑️ מחיקה: "מחק הוצאה אחרונה"\n🌐 דשבורד: "לינק"`;

  } else if (lower === 'לינק' || lower === 'דשבורד') {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    reply = `הדשבורד האישי שלך:\n${baseUrl}/dashboard?token=${user.dashboardToken}`;

  } else {
    const result = await addTransaction(user.id, body);
    if (result) {
      const { parsed, transaction } = result;
      const emoji = parsed.type === 'expense' ? '💸' : '💰';
      const typeText = parsed.type === 'expense' ? 'הוצאה' : 'הכנסה';
      reply = `${emoji} נרשמה ${typeText}!\n\nסכום: ${parsed.amount}₪\nקטגוריה: ${parsed.category}${parsed.description ? `\nתיאור: ${parsed.description}` : ''}`;

      // בדיקת חריגה מתקציב
      if (parsed.type === 'expense') {
        const alert = await checkBudgetAlert(user.id, parsed.category);
        if (alert) {
          if (alert.type === 'exceeded') {
            reply += `\n\n🔴 חרגת מהתקציב החודשי ל${alert.category}!\nהוצאת ${alert.spent.toFixed(0)}₪ מתוך ${alert.limit}₪`;
          } else {
            reply += `\n\n🟡 שימו לב: השתמשת ב-${alert.percent}% מהתקציב ל${alert.category} (${alert.spent.toFixed(0)}/${alert.limit}₪)`;
          }
        }
      }
    } else {
      reply = `אופס, לא הצלחתי להבין 😅\n\nנסה לכתוב כך:\n• "קניתי קפה ב-15 שקל"\n• "שילמתי חשמל 300 שקל"\n• "קיבלתי משכורת 8000 שקל"\n\nאו שלח "עזרה" לרשימה מלאה 😊`;
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
