const cron = require('node-cron');
const prisma = require('../db');
const { sendWhatsApp } = require('./twilioService');
const { getWeeklySummary } = require('./budgetService');

function startScheduler() {
  // כל יום ראשון בשעה 09:00 - עדכון שבועי לכל המשתמשים
  cron.schedule('0 9 * * 0', async () => {
    console.log('Running weekly summary job...');
    const users = await prisma.user.findMany();

    for (const user of users) {
      try {
        const summary = await getWeeklySummary(user.id);
        if (summary.count === 0) continue;

        let msg = `📊 סיכום שבועי - Budget Bot\n\n`;
        msg += `השבוע הוצאת: ${summary.total.toFixed(0)}₪\n`;
        msg += `מספר עסקאות: ${summary.count}\n`;
        if (summary.topCategory) {
          msg += `הוצאה הכי גדולה: ${summary.topCategory[0]} (${summary.topCategory[1].toFixed(0)}₪)\n`;
        }
        msg += `\nשלח "דוח" לסיכום מלא של החודש`;

        await sendWhatsApp(user.phone, msg);
      } catch (err) {
        console.error(`Weekly summary error for ${user.phone}:`, err.message);
      }
    }
  });
}

module.exports = { startScheduler };
