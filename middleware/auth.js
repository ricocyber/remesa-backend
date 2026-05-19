// ╔═══════════════════════════════════════════════════════════╗
// ║                  AUTH MIDDLEWARE                          ║
// ║           Verify JWT tokens on protected routes           ║
// ╚═══════════════════════════════════════════════════════════╝

const jwt = require('jsonwebtoken');
const prisma = require('../models');
const config = require('../config');

/**
 * Middleware to verify JWT and attach user to request
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'No token provided',
        code: 'AUTH_NO_TOKEN'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        code: 'AUTH_USER_NOT_FOUND'
      });
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        code: 'AUTH_INVALID_TOKEN'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'AUTH_TOKEN_EXPIRED'
      });
    }

    next(error);
  }
};

/**
 * Middleware to require KYC verification
 */
const requireKyc = (req, res, next) => {
  if (req.user.kycStatus !== 'VERIFIED') {
    return res.status(403).json({
      error: 'KYC verification required',
      code: 'KYC_REQUIRED',
      kycStatus: req.user.kycStatus
    });
  }
  next();
};

module.exports = {
  authenticate,
  requireKyc
};
