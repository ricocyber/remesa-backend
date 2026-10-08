// ╔═══════════════════════════════════════════════════════════╗
// ║                    REMESA FÁCIL                            ║
// ║              Backend Server - Entry Point                  ║
// ╚═══════════════════════════════════════════════════════════╝

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import routes — DB-free routes always load
const proofRailRoutes = require('./routes/proofRail');
const assetActionRoutes = require('./routes/assetActions');

// DB-dependent routes only load when DATABASE_URL is set
const DB_READY = !!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost');
let authRoutes, transferRoutes, userRoutes, webhookRoutes, fundraisingRoutes;
if (DB_READY) {
  authRoutes = require('./routes/auth');
  transferRoutes = require('./routes/transfers');
  userRoutes = require('./routes/users');
  webhookRoutes = require('./routes/webhooks');
  fundraisingRoutes = require('./routes/fundraising');
}

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ─────────────────────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ─────────────────────────────────────────────────────────────

// Helmet: Secure HTTP headers
app.use(helmet());

// CORS: Allow mobile app to connect
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Rate limiting: Prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// ─────────────────────────────────────────────────────────────
// BODY PARSING
// ─────────────────────────────────────────────────────────────

// Stripe webhooks need raw body
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// Everything else uses JSON
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// DB-free routes — always available
app.use('/api/proof-rail', proofRailRoutes);
app.use('/api', assetActionRoutes);

// DB-dependent routes — only when Postgres is connected
if (DB_READY) {
  app.use('/api/auth', authRoutes);
  app.use('/api/transfers', transferRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/fundraising', fundraisingRoutes);
} else {
  app.use('/api/auth', (req, res) => res.status(503).json({ error: 'Database not configured', status: 'coming_soon' }));
  app.use('/api/transfers', (req, res) => res.status(503).json({ error: 'Database not configured', status: 'coming_soon' }));
  app.use('/api/users', (req, res) => res.status(503).json({ error: 'Database not configured', status: 'coming_soon' }));
  app.use('/api/fundraising', (req, res) => res.status(503).json({ error: 'Database not configured', status: 'coming_soon' }));
}

// ─────────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────────

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 RemesaFácil Backend Running!                         ║
║                                                           ║
║   Port: ${PORT}                                              ║
║   Environment: ${process.env.NODE_ENV || 'development'}                           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
