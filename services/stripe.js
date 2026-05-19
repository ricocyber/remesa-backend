// ╔═══════════════════════════════════════════════════════════╗
// ║                  STRIPE SERVICE                           ║
// ║           Accept payments from US users                   ║
// ╚═══════════════════════════════════════════════════════════╝

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Create a payment intent to charge the user
 *
 * @param {Object} options
 * @param {number} options.amount - Amount in cents
 * @param {string} options.currency - Currency code (usd)
 * @param {string} options.paymentMethodId - Stripe payment method ID
 * @param {Object} options.metadata - Metadata to attach
 */
async function createPayment({ amount, currency, paymentMethodId, metadata }) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency,
    payment_method: paymentMethodId,
    confirm: true,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never'
    },
    metadata
  });

  return paymentIntent;
}

/**
 * Create a setup intent for saving payment method
 */
async function createSetupIntent(customerId) {
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card']
  });

  return setupIntent;
}

/**
 * Create a Stripe customer
 */
async function createCustomer({ email, phone, name }) {
  const customer = await stripe.customers.create({
    email,
    phone,
    name
  });

  return customer;
}

/**
 * Construct and verify webhook event
 */
function constructEvent(payload, signature) {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

/**
 * Refund a payment
 */
async function refundPayment(paymentIntentId, reason = 'requested_by_customer') {
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    reason
  });

  return refund;
}

module.exports = {
  createPayment,
  createSetupIntent,
  createCustomer,
  constructEvent,
  refundPayment
};
