// ╔═══════════════════════════════════════════════════════════╗
// ║                  AUTH ROUTES                              ║
// ║           Phone verification & login                      ║
// ╚═══════════════════════════════════════════════════════════╝

const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../models');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// POST /api/auth/send-code
// Send verification code to phone
// ─────────────────────────────────────────────────────────────

router.post('/send-code', async (req, res, next) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      throw new AppError('Phone number is required', 400, 'PHONE_REQUIRED');
    }

    // Generate 6-digit code (use fixed code in development for easy testing)
    const code = process.env.NODE_ENV === 'development' ? '123456' :
                 Math.floor(100000 + Math.random() * 900000).toString();

    // Save code to database (expires in 10 minutes)
    await prisma.verificationCode.create({
      data: {
        phone,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
      }
    });

    // In development, just log the code (no SMS needed)
    console.log(`\n📱 Verification code for ${phone}: ${code}\n`);

    res.json({
      success: true,
      message: 'Verification code sent',
      // Include code in response during development for easy testing
      ...(process.env.NODE_ENV === 'development' && { code })
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
    const { phone, code } = req.body;

    if (!phone || !code) {
      throw new AppError('Phone and code are required', 400, 'MISSING_FIELDS');
    }

    // Find valid code
    const verification = await prisma.verificationCode.findFirst({
      where: {
        phone,
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
    let user = await prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;

    if (!user) {
      user = await prisma.user.create({
        data: {
          phone,
          phoneVerified: true
        }
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
