const prisma = require('../db');

const DEFAULT_CATEGORIES = ['אוכל', 'תחבורה', 'בילויים', 'קניות', 'חשבונות', 'בריאות', 'שכ"ד', 'הלוואות', 'אחר'];

function parseFixedCommand(text) {
  const isExpense = text.includes('הוצאה קבועה');
  const isIncome = text.includes('הכנסה קבועה');
  if (!isExpense && !isIncome) return null;

  const type = isIncome ? 'income' : 'expense';
  const prefix = isExpense ? 'הוצאה קבועה' : 'הכנסה קבועה';

  const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1]);
  const description = text
    .replace(prefix, '')
    .replace(amountMatch[0], '')
    .replace(/₪|שקל|שח|ש"ח/g, '')
    .trim();

  let category = 'אחר';
  if (type === 'income') {
    category = 'הכנסה';
  } else {
    const lower = description.toLowerCase();
    if (/שכ"ד|שכירות|דירה/.test(lower)) category = 'שכ"ד';
    else if (/הלוואה|קרדיט|החזר/.test(lower)) category = 'הלוואות';
    else if (/חשמל|מים|ארנונה|אינטרנט|טלפון|גז|ביטוח/.test(lower)) category = 'חשבונות';
  }

  return { type, amount, description: description || prefix, category };
}

async function addFixedTransaction(userId, text) {
  const parsed = parseFixedCommand(text);
  if (!parsed) return null;

  const fixed = await prisma.fixedTransaction.create({
    data: {
      userId,
      amount: parsed.amount,
      type: parsed.type,
      category: parsed.category,
      description: parsed.description,
    },
  });
  return { fixed, parsed };
}

async function getFixedTransactions(userId, type) {
  const where = { userId, isActive: true };
  if (type) where.type = type;
  return prisma.fixedTransaction.findMany({ where, orderBy: { createdAt: 'asc' } });
}

async function deleteFixedTransaction(userId, type, index) {
  const items = await getFixedTransactions(userId, type);
  if (index < 1 || index > items.length) return null;
  const item = items[index - 1];
  await prisma.fixedTransaction.update({ where: { id: item.id }, data: { isActive: false } });
  return item;
}

// נקרא ע"י ה-scheduler ב-1 לחודש
async function applyFixedTransactions(userId) {
  const fixed = await getFixedTransactions(userId);
  const created = [];
  for (const f of fixed) {
    const t = await prisma.transaction.create({
      data: {
        userId,
        amount: f.amount,
        type: f.type,
        category: f.category,
        description: f.description,
      },
    });
    created.push(t);
  }
  return created;
}

async function getUserCategories(userId) {
  const custom = await prisma.category.findMany({ where: { userId } });
  const customNames = custom.map(c => c.name);
  const all = [...DEFAULT_CATEGORIES];
  for (const name of customNames) {
    if (!all.includes(name)) all.push(name);
  }
  return all;
}

async function addCustomCategory(userId, name) {
  const existing = await prisma.category.findFirst({ where: { userId, name } });
  if (existing) return null;
  return prisma.category.create({ data: { userId, name } });
}

module.exports = {
  DEFAULT_CATEGORIES,
  parseFixedCommand,
  addFixedTransaction,
  getFixedTransactions,
  deleteFixedTransaction,
  applyFixedTransactions,
  getUserCategories,
  addCustomCategory,
};
