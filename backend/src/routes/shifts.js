const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');

router.use(authenticate);

router.get('/', async (req, res) => {
  const branchId = scopeBranch(req, req.query.branch_id);
  const where = branchId ? { branch_id: branchId } : {};
  const shifts = await prisma.shiftType.findMany({ where, orderBy: [{ branch_id: 'asc' }, { start_time: 'asc' }] });
  res.json(shifts);
});

router.post('/', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.body.branch_id);
  const s = await prisma.shiftType.create({ data: { ...req.body, branch_id: branchId } });
  await logAudit({ user: req.user, branchId, action: 'shift.create', entity: 'ShiftType', entityId: s.id, newValue: s });
  res.status(201).json(s);
});

router.put('/:id', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const old = await prisma.shiftType.findUnique({ where: { id: req.params.id } });
  if (!old) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, old.branch_id);
  const s = await prisma.shiftType.update({ where: { id: req.params.id }, data: req.body });
  await logAudit({ user: req.user, branchId: s.branch_id, action: 'shift.update', entity: 'ShiftType', entityId: s.id, oldValue: old, newValue: s });
  res.json(s);
});

router.delete('/:id', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const s = await prisma.shiftType.findUnique({ where: { id: req.params.id } });
  if (!s) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, s.branch_id);
  await prisma.shiftType.update({ where: { id: req.params.id }, data: { active: false } });
  await logAudit({ user: req.user, branchId: s.branch_id, action: 'shift.deactivate', entity: 'ShiftType', entityId: s.id });
  res.json({ ok: true });
});

module.exports = router;
