const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');
const { notifyRoles, notifyUsers } = require('../utils/notify');

router.use(authenticate);

router.get('/', async (req, res) => {
  const where = {};
  if (req.user.role === 'staff') where.staff_id = req.user.staff_id;
  else if (req.user.role === 'branch_manager') where.staff = { branch_id: req.user.branch_id };
  if (req.query.status) where.status = req.query.status;
  const list = await prisma.leave.findMany({ where, include: { staff: true }, orderBy: { created_at: 'desc' } });
  res.json(list);
});

router.post('/', async (req, res) => {
  const staffId = req.user.role === 'staff' ? req.user.staff_id : req.body.staff_id;
  const l = await prisma.leave.create({
    data: { staff_id: staffId, from_date: new Date(req.body.from_date), to_date: new Date(req.body.to_date), reason: req.body.reason || null },
  });
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  await notifyRoles({ branchId: staff.branch_id, roles: ['branch_manager', 'super_admin'], title: 'Leave request', body: `${staff.full_name} requested leave.`, url: '/manager#leaves' });
  await logAudit({ user: req.user, branchId: staff.branch_id, action: 'leave.request', entity: 'Leave', entityId: l.id, newValue: l });
  res.status(201).json(l);
});

router.post('/:id/decide', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const { approve } = req.body;
  const l = await prisma.leave.findUnique({ where: { id: req.params.id }, include: { staff: true } });
  if (!l) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, l.staff.branch_id);
  const u = await prisma.leave.update({
    where: { id: l.id },
    data: { status: approve ? 'approved' : 'rejected', decided_by: req.user.id, decided_at: new Date() },
  });
  const user = await prisma.user.findUnique({ where: { staff_id: l.staff_id } });
  if (user) await notifyUsers([user.id], { title: `Leave ${approve ? 'approved' : 'rejected'}`, body: `${l.from_date.toISOString().slice(0,10)} → ${l.to_date.toISOString().slice(0,10)}` });
  await logAudit({ user: req.user, branchId: l.staff.branch_id, action: approve ? 'leave.approve' : 'leave.reject', entity: 'Leave', entityId: l.id, oldValue: l, newValue: u });
  res.json(u);
});

module.exports = router;
