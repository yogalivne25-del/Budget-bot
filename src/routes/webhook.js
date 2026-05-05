const express = require('express');
const router = express.Router();
const { findOrCreateUser, setUserName } = require('../services/userService');
const { addTransaction, getMonthlyReport } = require('../services/transactionService');

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
    reply = `שלום! אני Budget Bot 🤖\nאני עוזר לך לנהל את ההוצאות וההכנסות שלך.\n\nמה שמך?`;
  } else if (userState[from] === 'awaiting_name') {
    await setUserName(from, body);
    delete userState[from];
    reply = `נעים להכיר ${body}! 👋\n\nאיך אני עובד:\n• שלח לי הודעה כמו "קניתי קפה ב15 שקל"\n• או "קיבלתי משכורת 8000 שקל"\n• שלח "דוח" לסיכום החודש\n• שלח "עזרה" לרשימת פקודות`;
  } else if (lower === 'דוח' || lower === 'סיכום') {
    const report = await getMonthlyReport(user.id);
    reply = formatReport(report);
  } else if (lower === 'עזרה') {
    reply = `פקודות זמינות:\n\n💸 הוצאה: "קניתי/שילמתי/הוצאתי X שקל"\n💰 הכנסה: "קיבלתי/נכנס לי X שקל"\n📊 דוח חודשי: "דוח"\n🌐 דשבורד: "לינק"`;
  } else if (lower === 'לינק' || lower === 'דשבורד') {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    reply = `הדשבורד האישי שלך:\n${baseUrl}/dashboard?token=${user.dashboardToken}`;
  } else {
    const result = await addTransaction(user.id, body);
    if (result) {
      const { parsed } = result;
      const emoji = parsed.type === 'expense' ? '💸' : '💰';
      const typeText = parsed.type === 'expense' ? 'הוצאה' : 'הכנסה';
      reply = `${emoji} נרשמה ${typeText}!\n\nסכום: ${parsed.amount}₪\nקטגוריה: ${parsed.category}${parsed.description ? `\nתיאור: ${parsed.description}` : ''}\n\nשלח "דוח" לסיכום החודש`;
    } else {
      reply = `לא הבנתי 🤔\n\nנסה לכתוב למשל:\n"קניתי קפה ב15 שקל"\n"קיבלתי משכורת 8000 שקל"\n\nאו שלח "עזרה" לרשימת פקודות`;
    }
  }

  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`);
});

function formatReport(report) {
  const lines = [
    `📊 סיכום חודשי\n`,
    `💰 הכנסות: ${report.totalIncome.toFixed(2)}₪`,
    `💸 הוצאות: ${report.totalExpenses.toFixed(2)}₪`,
    `📈 יתרה: ${report.balance.toFixed(2)}₪\n`,
    `הוצאות לפי קטגוריה:`,
  ];

  for (const [cat, amount] of Object.entries(report.byCategory)) {
    lines.push(`  • ${cat}: ${amount.toFixed(2)}₪`);
  }

  return lines.join('\n');
}

module.exports = router;
