require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/version', (req, res) => res.json({ version: '2.0', updated: '2026-05-10' }));

app.use('/webhook', require('./src/routes/webhook'));
app.use('/dashboard', require('./src/routes/dashboard'));
app.use('/api', require('./src/routes/api'));
app.use('/payment', require('./src/services/paymentService'));

const { startScheduler } = require('./src/services/schedulerService');
startScheduler();

app.listen(PORT, () => {
  console.log(`Budget-bot server running on port ${PORT}`);
});
