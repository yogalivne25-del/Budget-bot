const cron = require('node-cron');
const prisma = require('../db');
const { sendWhatsApp } = require('./twilioService');
const { getWeeklySummary, getBudgets } = require('./budgetService');
const { getDueTodayReminders } = require('./reminderService');

function startScheduler() {
  // כל יום ראשון בשעה 09:00 - דוח שבועי עם מצב תקציבים
  cron.schedule('0 9 * * 0', async () => {
    console.log('Running weekly summary job...');
    const users = await prisma.user.findMany();

    for (const user of users) {
      try {
        const summary = await getWeeklySummary(user.id);
        if (summary.count === 0) continue;

        const budgets = await getBudgets(user.id);

        let msg = `📊 *דוח שבועי - Budget Bot*\n`;
        msg += `שלום ${user.name || ''}! הנה סיכום השבוע שלך:\n\n`;
        msg += `💸 הוצאות השבוע: *${summary.total.toFixed(0)}₪*\n`;
        msg += `🔢 מספר עסקאות: ${summary.count}\n`;

        if (summary.topCategory) {
          msg += `📌 הוצאה הכי גדולה: ${summary.topCategory[0]} (${summary.topCategory[1].toFixed(0)}₪)\n`;
        }

        if (budgets.length > 0) {
          msg += `\n🎯 *מצב תקציבים החודש:*\n`;
          const start = new Date();
          start.setDate(1);
          start.setHours(0, 0, 0, 0);

          const transactions = await prisma.transaction.findMany({
            where: { userId: user.id, type: 'expense', date: { gte: start } },
          }).catch(() => []);

          const byCategory = {};
          for (const t of transactions) {
            byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
          }

          for (const b of budgets) {
            const spent = byCategory[b.name] || 0;
            const pct = Math.round((spent / b.budgetLimit) * 100);
            const bar = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
            msg += `${bar} ${b.name}: ${spent.toFixed(0)}/${b.budgetLimit}₪ (${pct}%)\n`;
          }
        }

        msg += `\nשלח "דוח" לסיכום מלא של החודש 📈`;

        await sendWhatsApp(user.phone, msg);
      } catch (err) {
        console.error(`Weekly summary error for ${user.phone}:`, err.message);
      }
    }
  });

  // כל יום בשעה 09:00 - שליחת תזכורות
  cron.schedule('0 9 * * *', async () => {
    console.log('Running daily reminders job...');
    try {
      const dueReminders = await getDueTodayReminders();

      for (const reminder of dueReminders) {
        try {
          const msg = `⏰ *תזכורת!*\n\n${reminder.text}\n\n_מ-Budget Bot שלך_ 😊`;
          await sendWhatsApp(reminder.user.phone, msg);
        } catch (err) {
          console.error(`Reminder error for ${reminder.user.phone}:`, err.message);
        }
      }

      if (dueReminders.length > 0) {
        console.log(`Sent ${dueReminders.length} reminders`);
      }
    } catch (err) {
      console.error('Daily reminders error:', err.message);
    }
  });
}

module.exports = { startScheduler };
