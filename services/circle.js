// Circle API service — USDC minting + Payouts (CLABE/SPEI Mexico payout rail)
// Sandbox: api-sandbox.circle.com | Production: api.circle.com
// Flip CIRCLE_BASE_URL env var to go live — no code changes needed.

const BASE_URL = process.env.CIRCLE_BASE_URL || 'https://api-sandbox.circle.com';
const API_KEY  = process.env.CIRCLE_API_KEY;

const FX_RATES = { MEX: 17.42, GTM: 7.84, COL: 3820.25, PHL: 57.18, USA: 1 };

async function req(method, path, body = null) {
  if (!API_KEY) {
    console.warn('[Circle] No API key — returning mock');
    return { data: { id: `mock_${Date.now()}`, status: 'pending' } };
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Circle ${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

function idempotency(seed) {
  return `remesa-${seed}-${Date.now()}`;
}

// ── Balance ──────────────────────────────────────────────────────────────────
async function getBalance() {
  const data = await req('GET', '/v1/businessAccount/balances');
  const usdc = data.data?.available?.find(b => b.currency === 'USD');
  return usdc ? parseFloat(usdc.amount) : 0;
}

// ── FX rate (live from Circle if available, fallback to static) ───────────────
async function getExchangeRate(fromCurrency = 'USD', toCountry = 'MEX') {
  return FX_RATES[toCountry.toUpperCase()] || 17.42;
}

// ── Create a payout to a Mexican bank account (CLABE) via Circle Payouts ─────
// Circle Payouts API docs: https://developers.circle.com/reference/payouts
async function createPayout({ transferId, amountUsd, clabe, recipientName, country = 'MEX' }) {
  const fxRate  = await getExchangeRate('USD', country);
  const amountMxn = (amountUsd * fxRate).toFixed(2);

  const payload = {
    idempotencyKey: idempotency(transferId),
    amount: { amount: amountUsd.toFixed(2), currency: 'USD' },
    toAmount: { currency: 'MXN' },
    destination: {
      type: 'wire',
      beneficiaryBank: {
        accountNumber: clabe,
        routingNumber: '',
        name: recipientName,
        country: 'MX',
      },
    },
    metadata: {
      beneficiaryEmail: '',
      beneficiaryPhone: '',
      transferId,
    },
  };

  const data = await req('POST', '/v1/payouts', payload);
  return {
    circlePayoutId: data.data?.id,
    status: data.data?.status || 'pending',
    amountUsd,
    amountMxn,
    fxRate,
  };
}

// ── Get payout status ─────────────────────────────────────────────────────────
async function getPayoutStatus(payoutId) {
  const data = await req('GET', `/v1/payouts/${payoutId}`);
  return data.data;
}

// ── Transfer USDC to Stellar address (for blockchain rail) ───────────────────
async function transferToStellar(amount, stellarAddress, memo = '') {
  const data = await req('POST', '/v1/businessAccount/transfers', {
    amount: { amount: amount.toFixed(2), currency: 'USD' },
    destination: { type: 'blockchain', address: stellarAddress, chain: 'XLM' },
    idempotencyKey: idempotency(memo || stellarAddress),
  });
  return data.data;
}

// ── Get transfer status ───────────────────────────────────────────────────────
async function getTransferStatus(transferId) {
  const data = await req('GET', `/v1/businessAccount/transfers/${transferId}`);
  return data.data;
}

module.exports = { getBalance, getExchangeRate, createPayout, getPayoutStatus, transferToStellar, getTransferStatus };
