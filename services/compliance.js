// ╔═══════════════════════════════════════════════════════════╗
// ║                COMPLIANCE SERVICE                         ║
// ║  OFAC SDN screening + CTR flagging + Reg E disclosures   ║
// ║  Required by: BSA, 31 CFR §1010, 12 CFR Part 1005 Sub B ║
// ╚═══════════════════════════════════════════════════════════╝

const config = require('../config');

// ─────────────────────────────────────────────────────────────
// OFAC SDN SCREENING
// Every sender and recipient must be screened before transfer.
// In production: integrate Chainalysis, Elliptic, or OFAC API.
// ─────────────────────────────────────────────────────────────

/**
 * Screen a name against OFAC SDN list.
 * Production: replace with Chainalysis or Treasury OFAC API call.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} country - ISO 3-letter country code
 * @returns {{ cleared: boolean, reason: string|null }}
 */
async function screenOfac(firstName, lastName, country) {
  // Sanctioned countries — transfers blocked entirely
  const sanctionedCountries = ['CUB', 'IRN', 'PRK', 'RUS', 'SYR', 'VEN'];
  if (sanctionedCountries.includes(country)) {
    return {
      cleared: false,
      reason: `Transfers to ${country} are prohibited under OFAC sanctions`
    };
  }

  // Production: call OFAC API or Chainalysis here
  // const result = await chainalysis.screenName(firstName, lastName, country);
  // For now: log and pass (swap for real API before going live)
  if (process.env.NODE_ENV === 'production' && !process.env.OFAC_API_KEY) {
    console.error('⚠️ OFAC_API_KEY not set — BLOCKING transfer in production');
    return { cleared: false, reason: 'OFAC screening service not configured' };
  }

  console.log(`✅ OFAC screen: ${firstName} ${lastName} (${country}) — cleared (dev mode)`);
  return { cleared: true, reason: null };
}

// ─────────────────────────────────────────────────────────────
// CTR FLAG
// Transfers >= $10,000 require a Currency Transaction Report
// filed with FinCEN. Flag for manual compliance review.
// ─────────────────────────────────────────────────────────────

/**
 * Check if transfer requires CTR filing.
 * @param {number} amountUsd
 * @returns {boolean}
 */
function requiresCtr(amountUsd) {
  return amountUsd >= config.transfer.ctrThreshold;
}

// ─────────────────────────────────────────────────────────────
// EXCISE TAX CHECK (OBBBA 1%)
// Card/ACH = exempt. Cash/money order = 1% tax owed.
// ─────────────────────────────────────────────────────────────

/**
 * Calculate excise tax owed based on payment method.
 * @param {number} amountUsd
 * @param {string} paymentMethod - 'card' | 'ach' | 'cash' | 'money_order'
 * @returns {{ taxable: boolean, taxAmount: number }}
 */
function calculateExciseTax(amountUsd, paymentMethod = 'card') {
  const taxable = config.compliance.taxablePaymentMethods.includes(paymentMethod);
  return {
    taxable,
    taxAmount: taxable ? parseFloat((amountUsd * config.transfer.cashExciseTaxRate).toFixed(2)) : 0
  };
}

// ─────────────────────────────────────────────────────────────
// CFPB REG E DISCLOSURE BUILDER
// Must be shown to user BEFORE payment is charged.
// 12 CFR Part 1005 Subpart B
// ─────────────────────────────────────────────────────────────

/**
 * Build the pre-transaction disclosure object.
 * Frontend must display this and get explicit user confirmation.
 *
 * @param {Object} quote - From bitso.getExchangeRate + fee calculation
 * @param {string} recipientFirstName
 * @param {string} destinationCountry
 */
function buildRegEDisclosure(quote, recipientFirstName, destinationCountry) {
  return {
    // Required Reg E fields
    transferAmount: {
      value: quote.amountUsd,
      currency: 'USD',
      label: 'Cantidad a enviar'
    },
    fees: {
      value: quote.feeUsd,
      currency: 'USD',
      label: 'Tarifa El Norte (1.5%)'
    },
    totalCharged: {
      value: quote.totalUsd,
      currency: 'USD',
      label: 'Total cobrado a tu tarjeta'
    },
    exchangeRate: {
      value: quote.exchangeRate,
      label: `Tipo de cambio: 1 USD = ${quote.exchangeRate} MXN`
    },
    recipientReceives: {
      value: quote.amountMxn,
      currency: 'MXN',
      label: `${recipientFirstName} recibe`
    },
    deliveryEstimate: '7-10 minutos vía SPEI',
    destination: destinationCountry,
    // Cancellation rights (Reg E requirement)
    cancellationRights: `Puedes cancelar esta transferencia dentro de ${config.compliance.cancellationWindowMinutes} minutos sin costo.`,
    // Error resolution rights
    errorRights: 'Si hay un error, tienes hasta 180 días para reportarlo. Llama al número en la app.',
    // Timestamp for compliance record
    disclosureGeneratedAt: new Date().toISOString(),
    // This must be stored — proves disclosure was made
    disclosureVersion: '1.0'
  };
}

module.exports = {
  screenOfac,
  requiresCtr,
  calculateExciseTax,
  buildRegEDisclosure
};
