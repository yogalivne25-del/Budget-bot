const prisma = require('../db');

function autoCategory(text) {
  const lower = text.toLowerCase();
  if (/קפה|אוכל|מסעדה|סופר|מכולת|פיצה|סושי|ארוחה|לחם|חלב|מינימרקט|שוק|מזון|אכלתי/.test(lower)) return 'אוכל';
  if (/דלק|אוטובוס|רכבת|מונית|אובר|גט|פארקינג|חניה|אוטו|רכב/.test(lower)) return 'תחבורה';
  if (/בר|סרט|בילוי|פאב|מועדון|קונצרט|ספורט|כרטיס|אירוע|בידור/.test(lower)) return 'בילויים';
  if (/חשמל|מים|ארנונה|אינטרנט|טלפון|גז|ביטוח|ועד/.test(lower)) return 'חשבונות';
  if (/רופא|תרופה|בית חולים|קופת חולים|פארמה|אחות|בריאות|רפואה/.test(lower)) return 'בריאות';
  if (/חנות|קניון|אמזון|אלקטרוניקה|בגד|נעל|ביגוד|קנית|קניה/.test(lower)) return 'קניות';
  if (/שכ"ד|שכירות|דירה/.test(lower)) return 'שכ"ד';
  if (/הלוואה|קרדיט|החזר/.test(lower)) return 'הלוואות';
  return null; // לא בטוח → ישאל משתמש
}

function parseMessage(text) {
  const lower = text.trim();

  const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1]);
  if (amount <= 0) return null;

  const isIncome = /קיבלתי|משכורת|הכנסה|נכנס לי|הכנסתי|בונוס/.test(lower);

  const cleaned = text
    .replace(amountMatch[0], '')
    .replace(/₪|שקל|שח|ש"ח/g, '')
    .replace(/קיבלתי|קניתי|שילמתי|הוצאתי|עלה לי|קנה|שלמתי|הכנסה|נכנס לי|הכנסתי/g, '')
    .trim();

  if (isIncome) {
    return {
      amount,
      type: 'income',
      category: 'הכנסה',
      description: cleaned || 'הכנסה',
      isConfident: true,
    };
  }

  const category = autoCategory(text);
  return {
    amount,
    type: 'expense',
    category: category || 'אחר',
    description: cleaned || text,
    isConfident: category !== null,
  };
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

async function addTransactionDirect(userId, amount, type, category, description) {
  return prisma.transaction.create({
    data: { userId, amount, type, category, description },
  });
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

module.exports = { addTransaction, addTransactionDirect, getMonthlyReport, parseMessage, autoCategory };
