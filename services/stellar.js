// ╔═══════════════════════════════════════════════════════════╗
// ║                  STELLAR SERVICE                          ║
// ║           Blockchain transfers using USDC                 ║
// ╚═══════════════════════════════════════════════════════════╝

const StellarSdk = require('@stellar/stellar-sdk');
const config = require('../config');

// Connect to Stellar network
const server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);

// Set network passphrase
const networkPassphrase = config.stellar.network === 'mainnet'
  ? StellarSdk.Networks.PUBLIC
  : StellarSdk.Networks.TESTNET;

// USDC asset
const usdcAsset = new StellarSdk.Asset(
  config.stellar.usdcAsset.code,
  config.stellar.usdcAsset.issuer
);

/**
 * Send USDC from our US wallet to a destination address on Stellar.
 * Blockchain is the actual transfer rail — Juan sends, Maria receives.
 * Each country routes to a different off-ramp wallet (Bitso, direct USDC, etc.)
 *
 * @param {number} amount - Amount in USD
 * @param {string} memo - Transaction memo (tracking number, max 28 chars)
 * @param {string} destination - Stellar address of destination wallet (defaults to LATAM off-ramp wallet)
 */
async function sendUsdc(amount, memo = '', destination = null) {
  try {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(
      process.env.STELLAR_SECRET_KEY
    );
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

    // Route to country-specific off-ramp wallet, or default LATAM wallet
    const destinationAddress = destination
      || process.env.STELLAR_LATAM_WALLET
      || process.env.STELLAR_MEXICO_WALLET
      || sourceKeypair.publicKey();

    // Build transaction
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: destinationAddress,
          asset: usdcAsset,
          amount: amount.toString()
        })
      )
      .addMemo(StellarSdk.Memo.text(memo.slice(0, 28))) // Max 28 chars
      .setTimeout(180)
      .build();

    // Sign transaction
    transaction.sign(sourceKeypair);

    // Submit to network
    const result = await server.submitTransaction(transaction);

    console.log('✅ Stellar transaction successful:', result.hash);

    return {
      hash: result.hash,
      ledger: result.ledger,
      successful: result.successful
    };

  } catch (error) {
    console.error('Stellar transaction failed:', error);

    // Extract useful error info
    if (error.response?.data?.extras?.result_codes) {
      throw new Error(`Stellar error: ${JSON.stringify(error.response.data.extras.result_codes)}`);
    }

    throw error;
  }
}

/**
 * Get USDC balance of an account
 */
async function getBalance(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);

    const usdcBalance = account.balances.find(
      b => b.asset_code === 'USDC' && b.asset_issuer === config.stellar.usdcAsset.issuer
    );

    return usdcBalance ? parseFloat(usdcBalance.balance) : 0;

  } catch (error) {
    console.error('Error getting balance:', error);
    return 0;
  }
}

/**
 * Check if an account exists and has USDC trustline
 */
async function checkAccount(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);

    const hasUsdcTrustline = account.balances.some(
      b => b.asset_code === 'USDC' && b.asset_issuer === config.stellar.usdcAsset.issuer
    );

    return {
      exists: true,
      hasUsdcTrustline
    };

  } catch (error) {
    return {
      exists: false,
      hasUsdcTrustline: false
    };
  }
}

/**
 * Create a new Stellar wallet for a user
 * Returns keypair (store secret securely!)
 */
async function createWallet() {
  const keypair = StellarSdk.Keypair.random();

  // In testnet, we can fund the account using friendbot
  if (config.stellar.network === 'testnet') {
    try {
      await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
    } catch (e) {
      console.log('Friendbot funding failed, account not activated');
    }
  }

  return {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret()
  };
}

module.exports = {
  sendUsdc,
  getBalance,
  checkAccount,
  createWallet
};
