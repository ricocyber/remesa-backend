// ╔═══════════════════════════════════════════════════════════╗
// ║                  WEBHOOK ROUTES                           ║
// ║           Handle Stripe & other callbacks                 ║
// ╚═══════════════════════════════════════════════════════════╝

const express = require('express');
const prisma = require('../models');
const stripe = require('../services/stripe');
const stellar = require('../services/stellar');
const bitso = require('../services/bitso');
const { sendSms } = require('../services/twilio');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// POST /api/webhooks/stripe
// Handle Stripe payment events
// ─────────────────────────────────────────────────────────────

router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.constructEvent(req.body, sig);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────
// Payment succeeded - Process the transfer
// ─────────────────────────────────────────────────────────────

async function handlePaymentSuccess(paymentIntent) {
  const transferId = paymentIntent.metadata.transferId;

  if (!transferId) {
    console.error('No transferId in payment metadata');
    return;
  }

  try {
    const transfer = await prisma.transfer.findUnique({
      where: { id: transferId },
      include: { sender: true, recipient: true }
    });

    if (!transfer) {
      console.error('Transfer not found:', transferId);
      return;
    }

    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: 'PAID', paidAt: new Date() }
    });

    console.log(`💰 Payment received for transfer ${transferId}`);

    // ─────────────────────────────────────────────────────────
    // STEP 1: Send USDC on Stellar blockchain (BLOCKING)
    // Blockchain IS the transfer rail — not an audit trail.
    // Juan (USA) → USDC on Stellar → Maria (LATAM)
    // ─────────────────────────────────────────────────────────
    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: 'BLOCKCHAIN_PENDING' }
    });

    const stellarTx = await stellar.sendUsdc(
      parseFloat(transfer.amountUsd),
      `${transfer.trackingNumber}`
    );

    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        stellarTxHash: stellarTx.hash,
        status: 'BLOCKCHAIN_CONFIRMED'
      }
    });

    console.log(`⛓️ USDC sent on Stellar: ${stellarTx.hash}`);

    // ─────────────────────────────────────────────────────────
    // STEP 2: Local cash-out via Bitso → SPEI (BLOCKING)
    // USDC lands on Stellar → Bitso converts to MXN → SPEI to bank
    // ─────────────────────────────────────────────────────────
    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: 'PAYOUT_PENDING' }
    });

    const payout = await bitso.sendPayout({
      amount: transfer.amountMxn,
      currency: 'MXN',
      recipientClabe: transfer.recipient.clabe,
      recipientName: `${transfer.recipient.firstName} ${transfer.recipient.lastName}`,
      reference: transfer.trackingNumber
    });

    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        status: 'PAYOUT_PROCESSING',
        bitsoWithdrawId: payout.id
      }
    });

    console.log(`🌎 Payout initiated → ${transfer.recipient.country}: ${payout.id}`);

    // ─────────────────────────────────────────────────────────
    // STEP 3: SMS notifications (parallel, non-blocking)
    // ─────────────────────────────────────────────────────────
    await Promise.allSettled([
      sendSms(
        transfer.sender.phone,
        `✅ Tu envío de $${transfer.amountUsd} USD a ${transfer.recipient.firstName} está en camino. Blockchain confirmado. Rastreo: ${transfer.trackingNumber}`
      ),
      sendSms(
        transfer.recipient.phone,
        `💰 ${transfer.sender.firstName} te envió $${transfer.amountMxn} MXN. Llegará pronto a tu cuenta. TX: ${stellarTx.hash.slice(0, 8)}...`
      )
    ]);

  } catch (error) {
    console.error('Error processing transfer:', error);

    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: 'FAILED' }
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Payment failed
// ─────────────────────────────────────────────────────────────

async function handlePaymentFailed(paymentIntent) {
  const transferId = paymentIntent.metadata.transferId;

  if (!transferId) return;

  await prisma.transfer.update({
    where: { id: transferId },
    data: { status: 'PAYMENT_FAILED' }
  });

  console.log(`❌ Payment failed for transfer ${transferId}`);
}

module.exports = router;
