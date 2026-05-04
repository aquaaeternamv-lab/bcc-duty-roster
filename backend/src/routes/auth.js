const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');

function signTokens(user) {
  const access = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
  const jti = uuid();
  const refresh = jwt.sign({ userId: user.id, jti }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });
  return { access, refresh, jti };
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { branch: true, staff: true } });
  if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const { access, refresh, jti } = signTokens(user);
  const decoded = jwt.decode(refresh);
  await prisma.refreshToken.create({
    data: { user_id: user.id, jti, expires_at: new Date(decoded.exp * 1000) },
  });
  await prisma.user.update({ where: { id: user.id }, data: { last_login: new Date() } });
  res.json({
    access_token: access,
    refresh_token: refresh,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, branch_id: user.branch_id, branch: user.branch?.name, staff_id: user.staff_id },
  });
});

router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ error: 'Missing refresh_token' });
  let payload;
  try { payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET); }
  catch { return res.status(401).json({ error: 'Invalid refresh token' }); }
  const stored = await prisma.refreshToken.findUnique({ where: { jti: payload.jti } });
  if (!stored || stored.revoked || stored.expires_at < new Date()) {
    return res.status(401).json({ error: 'Refresh token expired' });
  }
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.active) return res.status(401).json({ error: 'User not found' });
  const t = signTokens(user);
  const decoded = jwt.decode(t.refresh);
  await prisma.refreshToken.create({ data: { user_id: user.id, jti: t.jti, expires_at: new Date(decoded.exp * 1000) } });
  res.json({ access_token: t.access, refresh_token: t.refresh });
});

router.post('/logout', authenticate, async (req, res) => {
  await prisma.refreshToken.updateMany({ where: { user_id: req.user.id, revoked: false }, data: { revoked: true } });
  res.json({ ok: true });
});

router.get('/me', authenticate, async (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, email: u.email, name: u.name, role: u.role,
    branch_id: u.branch_id, branch: u.branch?.name,
    staff_id: u.staff_id,
    staff: u.staff ? { id: u.staff.id, employee_id: u.staff.employee_id, full_name: u.staff.full_name, designation: u.staff.designation } : null,
  });
});

router.post('/change-password', authenticate, async (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 10) return res.status(400).json({ error: 'New password must be at least 10 chars' });
  const ok = await bcrypt.compare(old_password || '', req.user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Old password incorrect' });
  await prisma.user.update({ where: { id: req.user.id }, data: { password_hash: await bcrypt.hash(new_password, 10) } });
  res.json({ ok: true });
});

module.exports = router;
