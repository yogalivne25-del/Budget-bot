const prisma = require('../db');

// פירוש פקודת תזכורת
// "תזכורת שכר דירה ב-1 לחודש" → dayOfMonth=1
// "תזכורת חשבון חשמל כל ראשון" → dayOfWeek=0
function parseReminderCommand(text) {
  const lower = text.trim();

  // חיפוש יום בחודש: "ב-1 לחודש" / "ב-15 לחודש"
  const monthMatch = lower.match(/ב[־\-]?(\d{1,2})\s*לחודש/);
  if (monthMatch) {
    const day = parseInt(monthMatch[1]);
    if (day >= 1 && day <= 31) {
      const reminderText = lower
        .replace(/תזכורת\s*/i, '')
        .replace(monthMatch[0], '')
        .trim();
      return { text: reminderText || lower, dayOfMonth: day };
    }
  }

  // חיפוש יום בשבוע
  const dayNames = {
    'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3,
    'חמישי': 4, 'שישי': 5, 'שבת': 6,
  };
  for (const [name, num] of Object.entries(dayNames)) {
    if (lower.includes(`כל ${name}`) || lower.includes(`ב${name}`)) {
      const reminderText = lower
        .replace(/תזכורת\s*/i, '')
        .replace(new RegExp(`כל ${name}|ב${name}`, 'g'), '')
        .trim();
      return { text: reminderText || lower, dayOfWeek: num };
    }
  }

  return null;
}

async function addReminder(userId, text) {
  const parsed = parseReminderCommand(text);
  if (!parsed) return null;

  const reminder = await prisma.reminder.create({
    data: {
      userId,
      text: parsed.text,
      dayOfMonth: parsed.dayOfMonth ?? null,
      dayOfWeek: parsed.dayOfWeek ?? null,
    },
  });
  return { reminder, parsed };
}

async function getReminders(userId) {
  return prisma.reminder.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function deleteReminder(userId, index) {
  const reminders = await getReminders(userId);
  if (index < 1 || index > reminders.length) return null;
  const r = reminders[index - 1];
  await prisma.reminder.update({ where: { id: r.id }, data: { isActive: false } });
  return r;
}

// מחזיר תזכורות שצריך לשלוח היום
async function getDueTodayReminders() {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const dayOfWeek = now.getDay();

  return prisma.reminder.findMany({
    where: {
      isActive: true,
      OR: [
        { dayOfMonth },
        { dayOfWeek },
      ],
    },
    include: { user: true },
  });
}

function formatReminders(reminders) {
  if (reminders.length === 0) {
    return `אין לך תזכורות פעילות.\n\nכדי להוסיף:\n"תזכורת שכר דירה ב-1 לחודש"\n"תזכורת חשבון חשמל ב-15 לחודש"\n"תזכורת פגישה כל שני"`;
  }

  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const lines = ['⏰ התזכורות שלך:\n'];
  reminders.forEach((r, i) => {
    let when = '';
    if (r.dayOfMonth) when = `ב-${r.dayOfMonth} לחודש`;
    else if (r.dayOfWeek !== null) when = `כל ${dayNames[r.dayOfWeek]}`;
    lines.push(`${i + 1}. ${r.text} — ${when}`);
  });
  lines.push(`\nלמחיקה: "מחק תזכורת 1"`);
  return lines.join('\n');
}

module.exports = { parseReminderCommand, addReminder, getReminders, deleteReminder, getDueTodayReminders, formatReminders };
