const express = require('express');
const router = express.Router();
const { getUserByToken } = require('../services/userService');
const { getMonthlyReport } = require('../services/transactionService');

router.get('/', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(401).send('חסר טוקן');

  const user = await getUserByToken(token);
  if (!user) return res.status(404).send('משתמש לא נמצא');

  const report = await getMonthlyReport(user.id);

  res.send(renderDashboard(user, report));
});

function renderDashboard(user, report) {
  const categoryLabels = JSON.stringify(Object.keys(report.byCategory));
  const categoryData = JSON.stringify(Object.values(report.byCategory));
  const recentRows = report.transactions.slice(0, 10).map(t => `
    <tr>
      <td>${new Date(t.date).toLocaleDateString('he-IL')}</td>
      <td>${t.type === 'expense' ? '💸' : '💰'} ${t.category}</td>
      <td>${t.description || '-'}</td>
      <td style="color:${t.type === 'expense' ? '#e74c3c' : '#2ecc71'};font-weight:bold">
        ${t.type === 'expense' ? '-' : '+'}${t.amount.toFixed(2)}₪
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Budget Bot - הדשבורד שלי</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #f0f2f5; color: #333; }
    header { background: #25D366; color: white; padding: 20px 30px; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 1.4rem; }
    .container { max-width: 1000px; margin: 30px auto; padding: 0 20px; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 30px; }
    .card { background: white; border-radius: 12px; padding: 20px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card .label { font-size: 0.85rem; color: #666; margin-bottom: 8px; }
    .card .value { font-size: 1.8rem; font-weight: bold; }
    .income .value { color: #2ecc71; }
    .expense .value { color: #e74c3c; }
    .balance .value { color: #3498db; }
    .section { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 24px; }
    .section h2 { font-size: 1.1rem; margin-bottom: 20px; color: #444; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: right; border-bottom: 1px solid #f0f0f0; }
    th { background: #f8f9fa; font-size: 0.85rem; color: #666; }
    .chart-wrap { max-width: 300px; margin: 0 auto; }
    @media(max-width:600px) { .cards { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <span style="font-size:2rem">🤖</span>
    <div>
      <h1>Budget Bot</h1>
      <p style="font-size:0.85rem;opacity:0.9">שלום ${user.name || user.phone}! הנה הסיכום החודשי שלך</p>
    </div>
  </header>

  <div class="container">
    <div class="cards">
      <div class="card income">
        <div class="label">💰 הכנסות החודש</div>
        <div class="value">${report.totalIncome.toFixed(0)}₪</div>
      </div>
      <div class="card expense">
        <div class="label">💸 הוצאות החודש</div>
        <div class="value">${report.totalExpenses.toFixed(0)}₪</div>
      </div>
      <div class="card balance">
        <div class="label">📈 יתרה</div>
        <div class="value">${report.balance.toFixed(0)}₪</div>
      </div>
    </div>

    ${Object.keys(report.byCategory).length > 0 ? `
    <div class="section">
      <h2>הוצאות לפי קטגוריה</h2>
      <div class="chart-wrap">
        <canvas id="pieChart"></canvas>
      </div>
    </div>` : ''}

    <div class="section">
      <h2>עסקאות אחרונות</h2>
      ${report.transactions.length === 0
        ? '<p style="color:#999;text-align:center;padding:20px">עדיין אין עסקאות החודש.<br>שלח הודעה לבוט בוואטסאפ כדי להתחיל!</p>'
        : `<table><thead><tr><th>תאריך</th><th>קטגוריה</th><th>תיאור</th><th>סכום</th></tr></thead><tbody>${recentRows}</tbody></table>`}
    </div>
  </div>

  <script>
    const labels = ${categoryLabels};
    const data = ${categoryData};
    if (labels.length > 0) {
      new Chart(document.getElementById('pieChart'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data, backgroundColor: ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22'] }]
        },
        options: { plugins: { legend: { position: 'bottom' } } }
      });
    }
  </script>
</body>
</html>`;
}

module.exports = router;
