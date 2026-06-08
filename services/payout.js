// Payout service — routes to best available rail
// Rail priority: Stripe Payouts (debit card) → Circle (CLABE) → mock
// Mainnet flip = env vars only, no code changes.

const Stripe = require('stripe');
const circle = require('./circle');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const FX = { MEX: 17.42, GTM: 7.84, COL: 3820.25, PHL: 57.18, USA: 1 };

async function getFxRate(country = 'MEX') {
  return FX[country.toUpperCase()] || 17.42;
}

// Stripe Payouts — send USD to recipient debit card (Visa/MC, works in Mexico)
async function payoutToCard({ transferId, amountUsd, recipientDebitToken, recipientName, country = 'MEX' }) {
  const fxRate = await getFxRate(country);
  const transfer = await stripe.transfers.create({
    amount: Math.round(amountUsd * 100),
    currency: 'usd',
    destination: recipientDebitToken,
    transfer_group: transferId,
    metadata: { transferId, recipientName, country },
  });
  return {
    payoutId: transfer.id,
    rail: 'stripe',
    status: 'pending',
    amountUsd,
    amountLocal: (amountUsd * fxRate).toFixed(2),
    fxRate,
  };
}

// Circle Payouts — send USD → CLABE → SPEI (requires Circle KYB approval)
async function payoutToClabe({ transferId, amountUsd, clabe, recipientName, country = 'MEX' }) {
  return circle.createPayout({ transferId, amountUsd, clabe, recipientName, country });
}

// Router — picks rail based on what recipient has on file
async function sendPayout({ transferId, amountUsd, recipient }) {
  if (recipient.stripeDebitToken) {
    return payoutToCard({
      transferId, amountUsd,
      recipientDebitToken: recipient.stripeDebitToken,
      recipientName: `${recipient.firstName} ${recipient.lastName}`,
      country: recipient.country,
    });
  }
  if (recipient.clabe) {
    return payoutToClabe({
      transferId, amountUsd,
      clabe: recipient.clabe,
      recipientName: `${recipient.firstName} ${recipient.lastName}`,
      country: recipient.country,
    });
  }
  // Mock — no payout method on file yet
  console.warn(`[Payout] No payout method for recipient ${recipient.id} — mocking`);
  return { payoutId: `mock_${Date.now()}`, rail: 'mock', status: 'pending', amountUsd };
}

module.exports = { sendPayout, payoutToCard, payoutToClabe, getFxRate };
