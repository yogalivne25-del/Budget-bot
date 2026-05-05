const twilio = require('twilio');

function getClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function sendWhatsApp(to, body) {
  const client = getClient();
  if (!client) {
    console.log(`[Twilio mock] To: ${to}\n${body}`);
    return;
  }
  return client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to: `whatsapp:+${to}`,
    body,
  });
}

function validateWebhook(req, res, next) {
  const { TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_AUTH_TOKEN) return next();

  const valid = twilio.validateRequest(
    TWILIO_AUTH_TOKEN,
    req.headers['x-twilio-signature'] || '',
    `${process.env.BASE_URL}/webhook`,
    req.body
  );

  if (!valid) return res.status(403).send('Forbidden');
  next();
}

module.exports = { sendWhatsApp, validateWebhook };
