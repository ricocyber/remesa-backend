// ╔═══════════════════════════════════════════════════════════╗
// ║                    CONFIGURATION                          ║
// ╚═══════════════════════════════════════════════════════════╝

module.exports = {
  // App settings
  app: {
    name: 'RemesaFácil',
    env: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
  },

  // JWT settings
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-key-change-in-production',
    expiresIn: '7d',
  },

  // Transfer settings
  transfer: {
    minAmount: 10,        // Minimum $10 USD
    maxAmount: 2999,      // Maximum $2,999 USD (stay under $3K structuring threshold)
    feePercent: 1.5,      // 1.5% fee
    minFee: 1.99,         // Minimum $1.99 fee
    ctrThreshold: 10000,  // CTR required for transfers >= $10,000 (FinCEN BSA)
    // OBBBA excise tax: 1% on cash/money order payments. Card/ACH = EXEMPT.
    // Collect via Form 720 quarterly if you ever accept cash instruments.
    cashExciseTaxRate: 0.01,
  },

  // Compliance settings
  compliance: {
    // Accepted payment methods (all exempt from OBBBA 1% excise tax)
    exemptPaymentMethods: ['card', 'debit', 'ach', 'bank_transfer'],
    // Taxable payment methods (1% excise tax applies)
    taxablePaymentMethods: ['cash', 'money_order', 'cashiers_check'],
    // CFPB Reg E safe harbor: exempt if <= 500 transfers/year
    regESafeHarborLimit: 500,
    // Cancellation window: sender can cancel up to 30 minutes after payment
    cancellationWindowMinutes: 30,
  },

  // Stellar (blockchain) settings
  stellar: {
    network: process.env.STELLAR_NETWORK || 'testnet',
    horizonUrl: process.env.STELLAR_NETWORK === 'mainnet'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org',
    usdcAsset: {
      code: 'USDC',
      issuer: process.env.USDC_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', // Circle testnet
    },
  },

  // Supported countries — Stellar is the universal blockchain rail for all of them
  // Each country just needs a different local off-ramp (Bitso for MX, etc.)
  countries: {
    MEX: {
      name: 'Mexico',
      currency: 'MXN',
      payoutMethods: ['bank_transfer', 'cash_pickup'],
      offRamp: 'bitso',           // Bitso → SPEI (real-time, 5 seconds)
      bankIdField: 'clabe',       // 18-digit CLABE
    },
    GTM: {
      name: 'Guatemala',
      currency: 'GTQ',
      payoutMethods: ['bank_transfer', 'mobile_wallet'],
      offRamp: 'bitso',           // Bitso supports GTQ via ACH Guatemala
      bankIdField: 'account',
    },
    SLV: {
      name: 'El Salvador',
      currency: 'USD',            // Dollarized — no conversion needed
      payoutMethods: ['bank_transfer', 'usdc_wallet'],
      offRamp: 'direct_usdc',     // USDC stays as USDC — no conversion (El Salvador Bitcoin Law)
      bankIdField: 'account',
    },
    HND: {
      name: 'Honduras',
      currency: 'HNL',
      payoutMethods: ['bank_transfer', 'mobile_wallet'],
      offRamp: 'bitso',
      bankIdField: 'account',
    },
    COL: {
      name: 'Colombia',
      currency: 'COP',
      payoutMethods: ['bank_transfer', 'nequi', 'bancolombia'],
      offRamp: 'bitso',
      bankIdField: 'account',
    },
    DOM: {
      name: 'Dominican Republic',
      currency: 'DOP',
      payoutMethods: ['bank_transfer', 'cash_pickup'],
      offRamp: 'bitso',
      bankIdField: 'account',
    },
  },
};
