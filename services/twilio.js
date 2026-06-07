// ╔═══════════════════════════════════════════════════════════╗
// ║                  TWILIO SERVICE                           ║
// ║           SMS notifications                               ║
// ╚═══════════════════════════════════════════════════════════╝

const twilio = require('twilio');

const TWILIO_READY = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_ACCOUNT_SID.startsWith('AC');
const client = TWILIO_READY ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : null;

// ─────────────────────────────────────────────────────────────
// Send SMS
// ─────────────────────────────────────────────────────────────

async function sendSms(to, body) {
  if (!TWILIO_READY || process.env.NODE_ENV === 'development') {
    console.log(`[SMS mock] to=${to}: ${body}`);
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
