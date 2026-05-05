const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/webhook', require('./src/routes/webhook'));
app.use('/dashboard', require('./src/routes/dashboard'));

app.listen(PORT, () => {
  console.log(`Budget-bot server running on port ${PORT}`);
});
