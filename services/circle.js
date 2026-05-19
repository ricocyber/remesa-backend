// ╔═══════════════════════════════════════════════════════════╗
// ║                  CIRCLE SERVICE                           ║
// ║     Mint USDC programmatically via Circle API             ║
// ║     Replaces manual Stellar wallet funding                ║
// ║     Docs: https://developers.circle.com/reference         ║
// ╚═══════════════════════════════════════════════════════════╝

const CIRCLE_API_URL = 'https://api.circle.com/v1';
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;

async function circleRequest(method, path, body = null) {
  const res = await fetch(`${CIRCLE_API_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${CIRCLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Circle API error: ${JSON.stringify(data)}`);
  return data;
}

/**
 * Get USDC balance in Circle account
 */
async function getBalance() {
  const data = await circleRequest('GET', '/businessAccount/balances');
  const usdc = data.data?.available?.find(b => b.currency === 'USD');
  return usdc ? parseFloat(usdc.amount) : 0;
}

/**
 * Transfer USDC from Circle to a Stellar address
 * Used to fund the Stellar wallet for each remittance batch
 *
 * @param {number} amount - Amount in USD
 * @param {string} stellarAddress - Destination Stellar public key
 * @param {string} memo - Transfer memo
 */
async function transferToStellar(amount, stellarAddress, memo = '') {
  if (!CIRCLE_API_KEY) {
    console.warn('⚠️ CIRCLE_API_KEY not set — skipping Circle transfer');
    return { id: `mock_circle_${Date.now()}`, status: 'pending' };
  }

  const data = await circleRequest('POST', '/businessAccount/transfers', {
    amount: { amount: amount.toFixed(2), currency: 'USD' },
    destination: {
      type: 'blockchain',
      address: stellarAddress,
      chain: 'XLM'
    },
    idempotencyKey: `${memo}-${Date.now()}`
  });

  return data.data;
}

/**
 * Get transfer status
 */
async function getTransferStatus(transferId) {
  const data = await circleRequest('GET', `/businessAccount/transfers/${transferId}`);
  return data.data;
}

module.exports = {
  getBalance,
  transferToStellar,
  getTransferStatus
};
