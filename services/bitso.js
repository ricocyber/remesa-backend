// ╔═══════════════════════════════════════════════════════════╗
// ║                  BITSO SERVICE                            ║
// ║           Mexican crypto exchange for payouts             ║
// ║           https://bitso.com/api                           ║
// ╚═══════════════════════════════════════════════════════════╝

const crypto = require('crypto');

const BITSO_API_URL = process.env.BITSO_API_URL || 'https://api.bitso.com';
const BITSO_API_KEY = process.env.BITSO_API_KEY;
const BITSO_API_SECRET = process.env.BITSO_API_SECRET;

/**
 * Generate Bitso API signature
 */
function generateSignature(method, path, payload = '') {
  const nonce = Date.now().toString();
  const message = nonce + method + path + payload;

  const signature = crypto
    .createHmac('sha256', BITSO_API_SECRET)
    .update(message)
    .digest('hex');

  return { nonce, signature };
}

/**
 * Make authenticated request to Bitso API
 */
async function bitsoRequest(method, path, body = null) {
  const payload = body ? JSON.stringify(body) : '';
  const { nonce, signature } = generateSignature(method, path, payload);

  const response = await fetch(`${BITSO_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bitso ${BITSO_API_KEY}:${nonce}:${signature}`
    },
    body: body ? payload : undefined
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Bitso API error: ${data.error?.message || 'Unknown error'}`);
  }

  return data.payload;
}

/**
 * Get current exchange rate USD -> MXN
 * Uses the usd_mxn order book
 */
async function getExchangeRate(from = 'USD', to = 'MXN') {
  try {
    // Public endpoint, no auth needed
    const response = await fetch(`${BITSO_API_URL}/v3/ticker/?book=usd_mxn`);
    const data = await response.json();

    if (!data.success) {
      throw new Error('Failed to get exchange rate');
    }

    // Use the last trade price
    const rate = parseFloat(data.payload.last);

    console.log(`📈 Exchange rate: 1 USD = ${rate} MXN`);

    return rate;

  } catch (error) {
    console.error('Error getting exchange rate:', error);
    // Fallback to approximate rate
    return 17.5;
  }
}

/**
 * Send payout to Mexican bank account via SPEI
 *
 * @param {Object} options
 * @param {number} options.amount - Amount in MXN
 * @param {string} options.recipientClabe - 18-digit CLABE
 * @param {string} options.recipientName - Recipient name
 * @param {string} options.reference - Payment reference
 */
async function sendPayout({ amount, recipientClabe, recipientName, reference }) {
  try {
    // In production, use Bitso's SPEI withdrawal API
    const result = await bitsoRequest('POST', '/v3/spei_withdrawal/', {
      amount: amount.toFixed(2),
      recipient_given_names: recipientName.split(' ')[0],
      recipient_family_names: recipientName.split(' ').slice(1).join(' ') || 'N/A',
      clabe: recipientClabe,
      notes_ref: reference,
      numeric_ref: reference.replace(/\D/g, '').slice(0, 7) || '1234567'
    });

    console.log(`🇲🇽 SPEI withdrawal initiated: ${result.wid}`);

    return {
      id: result.wid,
      status: result.status,
      amount: result.amount
    };

  } catch (error) {
    console.error('Bitso payout error:', error);

    // For development/testing, return mock response
    if (process.env.NODE_ENV === 'development') {
      console.log('⚠️ Using mock payout response (development mode)');
      return {
        id: `mock_${Date.now()}`,
        status: 'pending',
        amount: amount
      };
    }

    throw error;
  }
}

/**
 * Get account balances
 */
async function getBalances() {
  const balances = await bitsoRequest('GET', '/v3/balance/');
  return balances.balances;
}

/**
 * Get withdrawal status
 */
async function getWithdrawalStatus(withdrawalId) {
  const withdrawals = await bitsoRequest('GET', `/v3/withdrawals/${withdrawalId}/`);
  return withdrawals;
}

module.exports = {
  getExchangeRate,
  sendPayout,
  getBalances,
  getWithdrawalStatus
};
