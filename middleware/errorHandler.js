// ╔═══════════════════════════════════════════════════════════╗
// ║                  ERROR HANDLER                            ║
// ║           Global error handling middleware                ║
// ╚═══════════════════════════════════════════════════════════╝

/**
 * Global error handler - catches all errors
 */
const errorHandler = (err, req, res, next) => {
  console.error('─────────────────────────────────────────');
  console.error('ERROR:', err.message);
  console.error('Stack:', err.stack);
  console.error('─────────────────────────────────────────');

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(400).json({
      error: 'A record with this value already exists',
      code: 'DUPLICATE_ENTRY'
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Record not found',
      code: 'NOT_FOUND'
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: err.message,
      code: 'VALIDATION_ERROR'
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    code: err.code || 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

/**
 * Custom error class with status code
 */
class AppError extends Error {
  constructor(message, statusCode = 400, code = 'APP_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = {
  errorHandler,
  AppError
};
