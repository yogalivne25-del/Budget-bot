const express = require('express');
const router = express.Router();
const { findOrCreateUser } = require('../services/userService');
const { sendWhatsApp } = require('../services/twilioService');

router.post('/register', async (req, res) => {
  let { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'מספר טלפון חסר' });

  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '972' + phone.slice(1);

  const user = await findOrCreateUser(phone);

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const dashboardUrl = `${baseUrl}/dashboard?token=${user.dashboardToken}`;

  await sendWhatsApp(
    phone,
    `שלום! ברוך הבא ל-Budget Bot 🤖\n\nאני אעזור לך לנהל את ההוצאות שלך בקלות.\n\nשלח לי הודעה כמו:\n"קניתי קפה ב15 שקל"\n"קיבלתי משכורת 8000 שקל"\n\nהדשבורד האישי שלך:\n${dashboardUrl}`
  );

  res.json({ ok: true });
});

module.exports = router;
