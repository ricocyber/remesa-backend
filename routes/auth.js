// ╔═══════════════════════════════════════════════════════════╗
// ║                  AUTH ROUTES                              ║
// ║           Phone verification & login                      ║
// ╚═══════════════════════════════════════════════════════════╝

const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../models');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');
const { sendVerificationCode } = require('../services/notify');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// POST /api/auth/send-code
// Send verification code to phone
// ─────────────────────────────────────────────────────────────

router.post('/send-code', async (req, res, next) => {
  try {
    const { phone, email } = req.body;
    const contact = email || phone;

    if (!contact) {
      throw new AppError('Phone or email is required', 400, 'CONTACT_REQUIRED');
    }

    const code = process.env.NODE_ENV === 'development' ? '123456' :
                 Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.verificationCode.create({
      data: {
        phone: contact,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    const result = await sendVerificationCode(contact, code);

    res.json({
      success: true,
      message: 'Verification code sent',
      channel: contact.includes('@') ? 'email' : 'sms',
      ...(result.mock && { code }),
    });

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/verify-code
// Verify code and login/register
// ─────────────────────────────────────────────────────────────

router.post('/verify-code', async (req, res, next) => {
  try {
    const { phone, email, code } = req.body;
    const contact = email || phone;

    if (!contact || !code) {
      throw new AppError('Contact and code are required', 400, 'MISSING_FIELDS');
    }

    const verification = await prisma.verificationCode.findFirst({
      where: {
        phone: contact,
        code,
        used: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!verification) {
      throw new AppError('Invalid or expired code', 400, 'INVALID_CODE');
    }

    // Mark code as used
    await prisma.verificationCode.update({
      where: { id: verification.id },
      data: { used: true }
    });

    // Find or create user
    let user = await prisma.user.findFirst({ where: contact.includes('@') ? { email: contact } : { phone: contact } });
    let isNewUser = false;

    if (!user) {
      user = await prisma.user.create({
        data: contact.includes('@')
          ? { email: contact, phone: contact, phoneVerified: true }
          : { phone: contact, phoneVerified: true }
      });
      isNewUser = true;
    } else {
      // Update existing user
      user = await prisma.user.update({
        where: { id: user.id },
        data: { phoneVerified: true }
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      success: true,
      token,
      isNewUser,
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        kycStatus: user.kycStatus
      }
    });

  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me
// Get current user
// ─────────────────────────────────────────────────────────────

const { authenticate } = require('../middleware/auth');

router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      phone: req.user.phone,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      email: req.user.email,
      kycStatus: req.user.kycStatus
    }
  });
});

module.exports = router;
