const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');

router.use(authenticate);

router.get('/', async (req, res) => {
  const where = req.user.role === 'super_admin' ? {} : { id: req.user.branch_id };
  const branches = await prisma.branch.findMany({ where, orderBy: { name: 'asc' } });
  res.json(branches);
});

router.get('/:id', async (req, res) => {
  const branchId = scopeBranch(req, req.params.id);
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return res.status(404).json({ error: 'Not found' });
  res.json(branch);
});

router.post('/', authorize('super_admin'), async (req, res) => {
  const b = await prisma.branch.create({ data: req.body });
  await logAudit({ user: req.user, branchId: b.id, action: 'branch.create', entity: 'Branch', entityId: b.id, newValue: b });
  res.status(201).json(b);
});

router.put('/:id', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.params.id);
  const old = await prisma.branch.findUnique({ where: { id: branchId } });
  const b = await prisma.branch.update({ where: { id: branchId }, data: req.body });
  await logAudit({ user: req.user, branchId, action: 'branch.update', entity: 'Branch', entityId: branchId, oldValue: old, newValue: b });
  res.json(b);
});

router.delete('/:id', authorize('super_admin'), async (req, res) => {
  await prisma.branch.update({ where: { id: req.params.id }, data: { active: false } });
  await logAudit({ user: req.user, branchId: req.params.id, action: 'branch.deactivate', entity: 'Branch', entityId: req.params.id });
  res.json({ ok: true });
});

module.exports = router;
