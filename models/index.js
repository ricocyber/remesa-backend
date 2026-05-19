// ╔═══════════════════════════════════════════════════════════╗
// ║                  DATABASE CLIENT                          ║
// ║              Prisma Client Singleton                      ║
// ╚═══════════════════════════════════════════════════════════╝

const { PrismaClient } = require('@prisma/client');

// Create a single instance to reuse across the app
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
