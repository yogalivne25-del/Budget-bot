const prisma = require('../db');

// פירוש פקודת הגדרת תקציב: "הגדר תקציב אוכל 1000 שקל"
function parseBudgetCommand(text) {
  const lower = text.trim();
  const match = lower.match(/הגדר\s+תקציב\s+(\S+)\s+(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { category: match[1], limit: parseFloat(match[2]) };
}

// פירוש פקודת מחיקה אחרונה
function isDeleteLastCommand(text) {
  return /מחק|בטל|הסר/.test(text) && /אחרון|אחרונה|הוצאה/.test(text);
}

async function setBudget(userId, category, limit) {
  const existing = await prisma.category.findFirst({ where: { userId, name: category } });
  if (existing) {
    return prisma.category.update({ where: { id: existing.id }, data: { budgetLimit: limit } });
  }
  return prisma.category.create({ data: { userId, name: category, budgetLimit: limit } });
}

async function getBudgets(userId) {
  return prisma.category.findMany({ where: { userId, budgetLimit: { not: null } } });
}

async function checkBudgetAlert(userId, category) {
  const budget = await prisma.category.findFirst({ where: { userId, name: category, budgetLimit: { not: null } } });
  if (!budget) return null;

  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const transactions = await prisma.transaction.findMany({
    where: { userId, category, type: 'expense', date: { gte: start } },
  });

  const totalSpent = transactions.reduce((s, t) => s + t.amount, 0);
  const percent = (totalSpent / budget.budgetLimit) * 100;

  if (percent >= 100) {
    return { type: 'exceeded', spent: totalSpent, limit: budget.budgetLimit, category };
  }
  if (percent >= 80) {
    return { type: 'warning', spent: totalSpent, limit: budget.budgetLimit, percent: Math.round(percent), category };
  }
  return null;
}

async function deleteLastTransaction(userId) {
  const last = await prisma.transaction.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
  });
  if (!last) return null;
  await prisma.transaction.delete({ where: { id: last.id } });
  return last;
}

async function getWeeklySummary(userId) {
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const transactions = await prisma.transaction.findMany({
    where: { userId, type: 'expense', date: { gte: start } },
  });

  const total = transactions.reduce((s, t) => s + t.amount, 0);
  const byCategory = {};
  for (const t of transactions) {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  }

  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  return { total, topCategory: topCategory || null, count: transactions.length };
}

module.exports = { parseBudgetCommand, isDeleteLastCommand, setBudget, getBudgets, checkBudgetAlert, deleteLastTransaction, getWeeklySummary };
