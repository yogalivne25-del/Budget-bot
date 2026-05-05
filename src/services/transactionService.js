const prisma = require('../db');

const CATEGORIES = ['אוכל', 'תחבורה', 'בילויים', 'קניות', 'בריאות', 'חשבונות', 'אחר'];

function parseMessage(text) {
  const lower = text.toLowerCase().trim();

  const expensePatterns = [
    /שילמתי|קניתי|הוצאתי|עלה לי|עלתה לי|קנה|שלמתי/,
  ];
  const incomePatterns = [
    /קיבלתי|הכנסה|משכורת|הכנסתי|נכנס לי/,
  ];

  const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:₪|שקל|שח|ש"ח)?/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1]);

  const isExpense = expensePatterns.some(p => p.test(lower));
  const isIncome = incomePatterns.some(p => p.test(lower));

  if (!isExpense && !isIncome) return null;

  const type = isIncome ? 'income' : 'expense';

  let category = 'אחר';
  if (/קפה|אוכל|מסעדה|סופר|מכולת|פיצה|סושי/.test(lower)) category = 'אוכל';
  else if (/דלק|אוטובוס|רכבת|מונית|אובר/.test(lower)) category = 'תחבורה';
  else if (/בר|סרט|בילוי|פאב|מועדון/.test(lower)) category = 'בילויים';
  else if (/חשמל|מים|ארנונה|אינטרנט|טלפון/.test(lower)) category = 'חשבונות';
  else if (/רופא|תרופה|בית חולים|קופת חולים/.test(lower)) category = 'בריאות';
  else if (/חנות|קניון|אמזון/.test(lower)) category = 'קניות';

  const descriptionMatch = text.replace(amountMatch[0], '').trim();

  return { amount, type, category, description: descriptionMatch || null };
}

async function addTransaction(userId, text) {
  const parsed = parseMessage(text);
  if (!parsed) return null;

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      amount: parsed.amount,
      type: parsed.type,
      category: parsed.category,
      description: parsed.description,
    },
  });

  return { transaction, parsed };
}

async function getMonthlyReport(userId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: start } },
    orderBy: { date: 'desc' },
  });

  const expenses = transactions.filter(t => t.type === 'expense');
  const income = transactions.filter(t => t.type === 'income');

  const totalExpenses = expenses.reduce((s, t) => s + t.amount, 0);
  const totalIncome = income.reduce((s, t) => s + t.amount, 0);

  const byCategory = {};
  for (const t of expenses) {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  }

  return { totalExpenses, totalIncome, balance: totalIncome - totalExpenses, byCategory, transactions };
}

module.exports = { addTransaction, getMonthlyReport, parseMessage, CATEGORIES };
