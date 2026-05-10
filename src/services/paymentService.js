const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const prisma = require('../db');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const PRICE_ILS = 12700; // 127 שקל במאיות
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// יצירת session תשלום
router.post('/create-checkout', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'חסר מספר טלפון' });

  let normalizedPhone = phone.replace(/\D/g, '');
  if (normalizedPhone.startsWith('0')) normalizedPhone = '972' + normalizedPhone.slice(1);

  let user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone: normalizedPhone } });
  }

  if (user.isPaid) {
    return res.json({ alreadyPaid: true, dashboardUrl: `${BASE_URL}/dashboard?token=${user.dashboardToken}` });
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'ils',
        product_data: {
          name: 'Budget Bot - גישה שנתית',
          description: 'ניהול הוצאות חכם בוואטסאפ למשך שנה',
        },
        unit_amount: PRICE_ILS,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}/#signup`,
    metadata: { userId: user.id, phone: normalizedPhone },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeSessionId: session.id },
  });

  res.json({ url: session.url });
});

// Webhook מ-Stripe - אישור תשלום
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, phone } = session.metadata;

    await prisma.user.update({
      where: { id: userId },
      data: { isPaid: true, paidAt: new Date() },
    });

    const { sendWhatsApp } = require('./twilioService');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    await sendWhatsApp(phone, `✅ התשלום התקבל! ברוך הבא ל-Budget Bot 🎉\n\nהדשבורד האישי שלך:\n${BASE_URL}/dashboard?token=${user.dashboardToken}\n\nשלח לי "שלום" כדי להתחיל!`);
  }

  res.json({ received: true });
});

module.exports = router;
