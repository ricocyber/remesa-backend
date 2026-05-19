// ╔═══════════════════════════════════════════════════════════╗
// ║                  TRANSFER ROUTES                          ║
// ║           Send money & track transfers                    ║
// ╚═══════════════════════════════════════════════════════════╝

const express = require('express');
const prisma = require('../models');
const config = require('../config');
const { authenticate, requireKyc } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const stripe = require('../services/stripe');
const stellar = require('../services/stellar');
const bitso = require('../services/bitso');
const { sendSms } = require('../services/twilio');
const { screenOfac, requiresCtr, calculateExciseTax, buildRegEDisclosure } = require('../services/compliance');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─────────────────────────────────────────────────────────────
// GET /api/transfers/quote
// Get a price quote for a transfer
// ─────────────────────────────────────────────────────────────

router.get('/quote', async (req, res, next) => {
  try {
    const { amount, country = 'MEX', paymentMethod = 'card', recipientFirstName = 'tu familiar' } = req.query;
    const amountUsd = parseFloat(amount);

    if (!amountUsd || amountUsd < config.transfer.minAmount) {
      throw new AppError(`Minimum amount is $${config.transfer.minAmount}`, 400);
    }
    if (amountUsd > config.transfer.maxAmount) {
      throw new AppError(`Maximum amount is $${config.transfer.maxAmount}`, 400);
    }

    const exchangeRate = await bitso.getExchangeRate('USD', 'MXN');

    let feeUsd = amountUsd * (config.transfer.feePercent / 100);
    if (feeUsd < config.transfer.minFee) feeUsd = config.transfer.minFee;

    const totalUsd = amountUsd + feeUsd;
    const amountMxn = amountUsd * exchangeRate;

    const quote = {
      amountUsd,
      feeUsd: parseFloat(feeUsd.toFixed(2)),
      totalUsd: parseFloat(totalUsd.toFixed(2)),
      exchangeRate: parseFloat(exchangeRate.toFixed(4)),
      amountMxn: parseFloat(amountMxn.toFixed(2)),
      expiresIn: 300
    };

    // CFPB Reg E disclosure — include in every quote response
    const excise = calculateExciseTax(amountUsd, paymentMethod);
    const disclosure = buildRegEDisclosure(quote, recipientFirstName, country);

    res.json({
      quote,
      disclosure,       // Frontend MUST display this before charging
      exciseTax: excise // 0 for card/ACH, 1% for cash
    });

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/transfers
// Create a new transfer
// ─────────────────────────────────────────────────────────────

router.post('/', requireKyc, async (req, res, next) => {
  try {
    const { recipientId, amountUsd, paymentMethodId } = req.body;

    // Validate amount
    if (!amountUsd || amountUsd < config.transfer.minAmount) {
      throw new AppError(`Minimum amount is $${config.transfer.minAmount}`, 400);
    }

    if (amountUsd > config.transfer.maxAmount) {
      throw new AppError(`Maximum amount is $${config.transfer.maxAmount}`, 400);
    }

    // Verify recipient belongs to user
    const recipient = await prisma.recipient.findFirst({
      where: { id: recipientId, userId: req.userId }
    });

    if (!recipient) {
      throw new AppError('Recipient not found', 404);
    }

    // ── OFAC SDN SCREENING (required before every transfer) ──
    const sender = await prisma.user.findUnique({ where: { id: req.userId } });

    const [senderScreen, recipientScreen] = await Promise.all([
      screenOfac(sender.firstName, sender.lastName, 'USA'),
      screenOfac(recipient.firstName, recipient.lastName, recipient.country)
    ]);

    if (!senderScreen.cleared) {
      throw new AppError(`Transfer blocked: ${senderScreen.reason}`, 403, 'OFAC_BLOCKED');
    }
    if (!recipientScreen.cleared) {
      throw new AppError(`Transfer blocked: ${recipientScreen.reason}`, 403, 'OFAC_BLOCKED');
    }

    // ── CTR FLAG (>= $10,000 requires FinCEN Currency Transaction Report) ──
    const needsCtr = requiresCtr(amountUsd);
    if (needsCtr) {
      console.warn(`⚠️ CTR REQUIRED: Transfer $${amountUsd} by user ${req.userId} — flag for compliance review`);
      // Production: create CTR record and route to compliance officer
    }

    // Get exchange rate
    const exchangeRate = await bitso.getExchangeRate('USD', 'MXN');

    // Calculate fee
    let feeUsd = amountUsd * (config.transfer.feePercent / 100);
    if (feeUsd < config.transfer.minFee) {
      feeUsd = config.transfer.minFee;
    }

    const totalUsd = amountUsd + feeUsd;
    const amountMxn = amountUsd * exchangeRate;

    // Create transfer record
    const transfer = await prisma.transfer.create({
      data: {
        senderId: req.userId,
        recipientId,
        amountUsd,
        feeUsd,
        totalUsd,
        exchangeRate,
        amountMxn,
        status: 'PENDING'
      },
      include: {
        recipient: true
      }
    });

    // Charge the card via Stripe
    try {
      const paymentIntent = await stripe.createPayment({
        amount: Math.round(totalUsd * 100), // Stripe uses cents
        currency: 'usd',
        paymentMethodId,
        metadata: {
          transferId: transfer.id,
          userId: req.userId
        }
      });

      // Update transfer with payment ID
      await prisma.transfer.update({
        where: { id: transfer.id },
        data: {
          stripePaymentId: paymentIntent.id,
          status: 'PAYMENT_PROCESSING'
        }
      });

      res.status(201).json({
        success: true,
        transfer: {
          id: transfer.id,
          trackingNumber: transfer.trackingNumber,
          amountUsd: transfer.amountUsd,
          feeUsd: transfer.feeUsd,
          totalUsd: transfer.totalUsd,
          amountMxn: transfer.amountMxn,
          exchangeRate: transfer.exchangeRate,
          status: 'PAYMENT_PROCESSING',
          recipient: {
            firstName: recipient.firstName,
            lastName: recipient.lastName
          }
        },
        clientSecret: paymentIntent.client_secret // For frontend to confirm
      });

    } catch (stripeError) {
      // Update transfer as failed
      await prisma.transfer.update({
        where: { id: transfer.id },
        data: { status: 'PAYMENT_FAILED' }
      });

      throw new AppError(`Payment failed: ${stripeError.message}`, 400, 'PAYMENT_FAILED');
    }

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/transfers
// Get user's transfer history
// ─────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const transfers = await prisma.transfer.findMany({
      where: { senderId: req.userId },
      include: {
        recipient: {
          select: {
            firstName: true,
            lastName: true,
            country: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const total = await prisma.transfer.count({
      where: { senderId: req.userId }
    });

    res.json({
      transfers,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/transfers/:id
// Get single transfer details
// ─────────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const transfer = await prisma.transfer.findFirst({
      where: { id, senderId: req.userId },
      include: {
        recipient: true
      }
    });

    if (!transfer) {
      throw new AppError('Transfer not found', 404);
    }

    res.json({ transfer });

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/transfers/track/:trackingNumber
// Track a transfer by tracking number (public)
// ─────────────────────────────────────────────────────────────

router.get('/track/:trackingNumber', async (req, res, next) => {
  try {
    const { trackingNumber } = req.params;

    const transfer = await prisma.transfer.findUnique({
      where: { trackingNumber },
      select: {
        trackingNumber: true,
        amountMxn: true,
        status: true,
        createdAt: true,
        completedAt: true,
        recipient: {
          select: {
            firstName: true,
            country: true
          }
        }
      }
    });

    if (!transfer) {
      throw new AppError('Transfer not found', 404);
    }

    res.json({ transfer });

  } catch (error) {
    next(error);
  }
});

module.exports = router;
