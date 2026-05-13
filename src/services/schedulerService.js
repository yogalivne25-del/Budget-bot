const cron = require('node-cron');
const prisma = require('../db');
const { sendWhatsApp } = require('./twilioService');
const { getWeeklySummary } = require('./budgetService');
const { applyFixedTransactions } = require('./fixedTransactionService');

const MOTIVATIONAL = [
  'מודעות למספרים זה כל המשחק - מכאן זה רק משתפר 💪',
  'מי שעוקב אחרי ההוצאות שלו - שולט בחייו הכלכליים 🚀',
  'כל שקל שאתה מודע אליו הוא שקל שאתה שולט בו ✨',
  'מיקוד בהוצאות היום = חופש כלכלי מחר 🌟',
  'המפתח לחיסכון הוא לדעת לאן הכסף הולך - ואתה יודע! 💰',
  'כל שבוע שאתה עוקב - אתה צועד קדימה. המשך כך! 🎯',
];

function startScheduler() {
  // כל ראשון ב-09:00 - דוח שבועי פשוט עם חיזוק
  cron.schedule('0 9 * * 0', async () => {
    console.log('Running weekly summary job...');
    const users = await prisma.user.findMany();

    for (const user of users) {
      try {
        const summary = await getWeeklySummary(user.id);
        if (summary.count === 0) continue;

        const motivation = MOTIVATIONAL[Math.floor(Math.random() * MOTIVATIONAL.length)];

        let msg = `📊 *סיכום שבועי*\n\n`;
        msg += `שלום ${user.name || ''}!\n\n`;
        msg += `💸 הוצאות השבוע: *${summary.total.toFixed(0)}₪*\n`;
        if (summary.topCategory) {
          msg += `📌 הכי הרבה על: ${summary.topCategory[0]} (${summary.topCategory[1].toFixed(0)}₪)\n`;
        }
        msg += `\n${motivation}`;

        await sendWhatsApp(user.phone, msg);
      } catch (err) {
        console.error(`Weekly summary error for ${user.phone}:`, err.message);
      }
    }
  });

  // ב-1 לכל חודש בשעה 07:00 - רישום הוצאות/הכנסות קבועות
  cron.schedule('0 7 1 * *', async () => {
    console.log('Running monthly fixed transactions job...');
    const users = await prisma.user.findMany();

    for (const user of users) {
      try {
        const created = await applyFixedTransactions(user.id);
        if (created.length === 0) continue;

        const expenses = created.filter(t => t.type === 'expense');
        const income = created.filter(t => t.type === 'income');

        let msg = `🔄 *חודש חדש - הוצאות וה כנסות קבועות נרשמו!*\n\n`;
        if (expenses.length > 0) {
          msg += `💸 הוצאות:\n`;
          for (const e of expenses) msg += `• ${e.description}: ${e.amount}₪\n`;
        }
        if (income.length > 0) {
          msg += `\n💰 הכנסות:\n`;
          for (const i of income) msg += `• ${i.description}: ${i.amount}₪\n`;
        }
        msg += `\nשלח "דוח" לסיכום מלא 📊`;

        await sendWhatsApp(user.phone, msg);
      } catch (err) {
        console.error(`Monthly fixed error for ${user.phone}:`, err.message);
      }
    }
  });
}

module.exports = { startScheduler };
