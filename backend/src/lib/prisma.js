const { PrismaClient } = require('@prisma/client');

const prisma = global.__bccPrisma || new PrismaClient({ log: ['warn', 'error'] });
if (process.env.NODE_ENV !== 'production') global.__bccPrisma = prisma;

module.exports = prisma;
