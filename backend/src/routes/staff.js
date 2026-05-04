const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');

router.use(authenticate);

router.get('/', async (req, res) => {
  const branchId = scopeBranch(req, req.query.branch_id);
  const where = branchId ? { branch_id: branchId } : {};
  if (req.query.active !== undefined) where.active = req.query.active === 'true';
  const staff = await prisma.staff.findMany({ where, include: { branch: true, user: { select: { id: true, email: true, role: true } } }, orderBy: { full_name: 'asc' } });
  res.json(staff);
});

router.get('/:id', async (req, res) => {
  const s = await prisma.staff.findUnique({ where: { id: req.params.id }, include: { branch: true, user: true } });
  if (!s) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, s.branch_id);
  res.json(s);
});

router.post('/', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.body.branch_id);
  const { create_login, login_email, login_password, ...staffData } = req.body;
  const s = await prisma.staff.create({ data: { ...staffData, branch_id: branchId } });
  if (create_login && login_email && login_password) {
    await prisma.user.create({
      data: {
        email: login_email.toLowerCase(),
        name: s.full_name,
        password_hash: await bcrypt.hash(login_password, 10),
        role: 'staff',
        branch_id: branchId,
        staff_id: s.id,
      },
    });
  }
  await logAudit({ user: req.user, branchId, action: 'staff.create', entity: 'Staff', entityId: s.id, newValue: s });
  res.status(201).json(s);
});

router.put('/:id', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const old = await prisma.staff.findUnique({ where: { id: req.params.id } });
  if (!old) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, old.branch_id);
  const s = await prisma.staff.update({ where: { id: req.params.id }, data: req.body });
  await logAudit({ user: req.user, branchId: s.branch_id, action: 'staff.update', entity: 'Staff', entityId: s.id, oldValue: old, newValue: s });
  res.json(s);
});

router.delete('/:id', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const s = await prisma.staff.findUnique({ where: { id: req.params.id } });
  if (!s) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, s.branch_id);
  await prisma.staff.update({ where: { id: req.params.id }, data: { active: false } });
  await logAudit({ user: req.user, branchId: s.branch_id, action: 'staff.deactivate', entity: 'Staff', entityId: s.id });
  res.json({ ok: true });
});

module.exports = router;
