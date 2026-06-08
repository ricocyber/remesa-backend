// Notification service — email via Resend (primary), SMS via Twilio (when available)

const RESEND_READY = !!process.env.RESEND_API_KEY;
const TWILIO_READY = process.env.TWILIO_ACCOUNT_SID?.startsWith('AC');
const FROM_EMAIL = process.env.REMESA_FROM_EMAIL || 'onboarding@resend.dev';

async function sendVerificationCode(contact, code) {
  // contact = phone number or email
  const isEmail = contact.includes('@');

  if (isEmail && RESEND_READY) {
    return sendEmailCode(contact, code);
  }

  if (!isEmail && TWILIO_READY) {
    const { sendVerificationCode: twilioSend } = require('./twilio');
    return twilioSend(contact, code);
  }

  // Mock — log to console, return code so frontend can display it during dev
  console.log(`[NOTIFY mock] Verification code for ${contact}: ${code}`);
  return { success: true, mock: true, code };
}

async function sendEmailCode(email, code) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `RemesaFácil <${FROM_EMAIL}>`,
        to: [email],
        subject: `Tu código de acceso: ${code}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1a1a1a;margin-bottom:8px">RemesaFácil</h2>
            <p style="color:#666;margin-bottom:24px">Tu código de verificación es:</p>
            <div style="background:#f5f5f5;border-radius:8px;padding:24px;text-align:center">
              <span style="font-size:40px;font-weight:700;letter-spacing:8px;color:#1a1a1a">${code}</span>
            </div>
            <p style="color:#999;font-size:13px;margin-top:24px">Válido por 10 minutos. No compartas este código.</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[Resend error]', err);
      return { success: false, error: err };
    }

    return { success: true };
  } catch (err) {
    console.error('[Resend error]', err.message);
    return { success: false, error: err.message };
  }
}

async function sendTransferNotification(contact, { recipientName, amount, currency }) {
  const msg = `RemesaFácil: Tu transferencia de ${amount} ${currency} a ${recipientName} está en proceso.`;
  const isEmail = contact.includes('@');

  if (isEmail && RESEND_READY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `RemesaFácil <${FROM_EMAIL}>`,
        to: [contact],
        subject: `Transferencia en proceso — ${amount} ${currency}`,
        html: `<p>${msg}</p>`,
      }),
    });
    return { success: true };
  }

  if (!isEmail && TWILIO_READY) {
    const { sendSms } = require('./twilio');
    return sendSms(contact, msg);
  }

  console.log(`[NOTIFY mock] ${msg}`);
  return { success: true, mock: true };
}

module.exports = { sendVerificationCode, sendTransferNotification };
