require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// rate limits
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300 }));

// routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/branches', require('./src/routes/branches'));
app.use('/api/staff', require('./src/routes/staff'));
app.use('/api/shifts', require('./src/routes/shifts'));
app.use('/api/roster', require('./src/routes/roster'));
app.use('/api/swaps', require('./src/routes/swaps'));
app.use('/api/attendance', require('./src/routes/attendance'));
app.use('/api/leaves', require('./src/routes/leaves'));
app.use('/api/payroll', require('./src/routes/payroll'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/audit', require('./src/routes/audit'));

app.get('/health', async (req, res) => {
  try {
    const prisma = require('./src/lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'degraded', reason: 'database_unavailable' });
  }
});

// serve frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

// global error handler
app.use((err, req, res, next) => {
  console.error('[err]', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4001;
const server = app.listen(PORT, () => {
  console.log(`[BCC Roster] http://localhost:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
