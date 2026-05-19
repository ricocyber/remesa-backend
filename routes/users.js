// ╔═══════════════════════════════════════════════════════════╗
// ║                  USER ROUTES                              ║
// ║           Profile & recipient management                  ║
// ╚═══════════════════════════════════════════════════════════╝

const express = require('express');
const prisma = require('../models');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─────────────────────────────────────────────────────────────
// PUT /api/users/profile
// Update user profile
// ─────────────────────────────────────────────────────────────

router.put('/profile', async (req, res, next) => {
  try {
    const { firstName, lastName, email } = req.body;

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        firstName,
        lastName,
        email
      }
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        kycStatus: user.kycStatus
      }
    });

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/users/recipients
// Get all saved recipients
// ─────────────────────────────────────────────────────────────

router.get('/recipients', async (req, res, next) => {
  try {
    const recipients = await prisma.recipient.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ recipients });

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/users/recipients
// Add a new recipient
// ─────────────────────────────────────────────────────────────

router.post('/recipients', async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      country = 'MEX',
      payoutMethod = 'BANK_TRANSFER',
      bankName,
      bankAccount,
      clabe
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !phone) {
      throw new AppError('First name, last name, and phone are required', 400);
    }

    // Validate bank details for bank transfer
    if (payoutMethod === 'BANK_TRANSFER' && !clabe) {
      throw new AppError('CLABE is required for bank transfers', 400);
    }

    // Validate CLABE format (18 digits for Mexico)
    if (clabe && !/^\d{18}$/.test(clabe)) {
      throw new AppError('CLABE must be 18 digits', 400);
    }

    const recipient = await prisma.recipient.create({
      data: {
        userId: req.userId,
        firstName,
        lastName,
        phone,
        country,
        payoutMethod,
        bankName,
        bankAccount,
        clabe
      }
    });

    res.status(201).json({
      success: true,
      recipient
    });

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/users/recipients/:id
// Delete a recipient
// ─────────────────────────────────────────────────────────────

router.delete('/recipients/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify recipient belongs to user
    const recipient = await prisma.recipient.findFirst({
      where: { id, userId: req.userId }
    });

    if (!recipient) {
      throw new AppError('Recipient not found', 404);
    }

    await prisma.recipient.delete({ where: { id } });

    res.json({ success: true });

  } catch (error) {
    next(error);
  }
});

module.exports = router;
