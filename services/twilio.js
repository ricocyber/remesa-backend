// ╔═══════════════════════════════════════════════════════════╗
// ║                  TWILIO SERVICE                           ║
// ║           SMS notifications                               ║
// ╚═══════════════════════════════════════════════════════════╝

const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ─────────────────────────────────────────────────────────────
// Send SMS
// ─────────────────────────────────────────────────────────────

async function sendSms(to, body) {
  // In development, just log instead of sending
  if (process.env.NODE_ENV === 'development') {
    console.log(`\n📱 SMS to ${to}: ${body}\n`);
    return { success: true, mock: true };
  }

  try {
    const message = await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });

    return {
      success: true,
      messageId: message.sid
    };
  } catch (error) {
    console.error('Twilio SMS error:', error);
    // Don't throw - allow app to continue without SMS
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// Send verification code
// ─────────────────────────────────────────────────────────────

async function sendVerificationCode(phone, code) {
  return sendSms(phone, `Tu código de RemesaFácil es: ${code}`);
}

// ─────────────────────────────────────────────────────────────
// Send transfer notification
// ─────────────────────────────────────────────────────────────

async function sendTransferNotification(phone, { recipientName, amount, currency }) {
  const message = `RemesaFácil: Tu transferencia de ${amount} ${currency} a ${recipientName} está en proceso.`;
  return sendSms(phone, message);
}

module.exports = {
  sendSms,
  sendVerificationCode,
  sendTransferNotification
};
