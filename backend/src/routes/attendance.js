const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');

router.use(authenticate);

router.get('/', async (req, res) => {
  const branchId = scopeBranch(req, req.query.branch_id);
  const where = branchId ? { branch_id: branchId } : {};
  if (req.query.from && req.query.to) where.date = { gte: new Date(req.query.from), lte: new Date(req.query.to) };
  if (req.query.staff_id) where.staff_id = req.query.staff_id;
  const list = await prisma.attendance.findMany({ where, include: { staff: true, duty: { include: { shift_type: true } } }, orderBy: { date: 'desc' }, take: 500 });
  res.json(list);
});

// Staff clock-in/out
router.post('/clock-in', authorize('staff'), async (req, res) => {
  const { duty_id } = req.body;
  const duty = await prisma.duty.findUnique({ where: { id: duty_id }, include: { roster: true } });
  if (!duty || duty.staff_id !== req.user.staff_id) return res.status(403).json({ error: 'Not your duty' });
  const now = new Date();
  const lateMin = Math.max(0, Math.round((now - duty.start_at) / 60000));
  const att = await prisma.attendance.upsert({
    where: { duty_id },
    create: {
      duty_id, staff_id: duty.staff_id, branch_id: duty.roster.branch_id, date: duty.date,
      scheduled_start: duty.start_at, scheduled_end: duty.end_at,
      actual_start: now, status: lateMin > 5 ? 'late' : 'worked', late_minutes: lateMin,
    },
    update: { actual_start: now, late_minutes: lateMin, status: lateMin > 5 ? 'late' : 'worked' },
  });
  res.json(att);
});

router.post('/clock-out', authorize('staff'), async (req, res) => {
  const { duty_id } = req.body;
  const att = await prisma.attendance.findUnique({ where: { duty_id }, include: { duty: true } });
  if (!att || att.staff_id !== req.user.staff_id) return res.status(403).json({ error: 'Not your duty' });
  const now = new Date();
  const overtimeHrs = Math.max(0, (now - att.scheduled_end) / 3600000);
  const updated = await prisma.attendance.update({
    where: { duty_id }, data: { actual_end: now, overtime_hours: overtimeHrs, status: overtimeHrs > 0 ? 'overtime' : att.status },
  });
  res.json(updated);
});

// Manager manual record / adjustment
router.post('/', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.body.branch_id);
  const a = await prisma.attendance.create({ data: { ...req.body, branch_id: branchId, approved_by: req.user.id, approved_at: new Date() } });
  await logAudit({ user: req.user, branchId, action: 'attendance.create', entity: 'Attendance', entityId: a.id, newValue: a });
  res.status(201).json(a);
});

router.put('/:id', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const old = await prisma.attendance.findUnique({ where: { id: req.params.id } });
  if (!old) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, old.branch_id);
  const a = await prisma.attendance.update({ where: { id: req.params.id }, data: { ...req.body, approved_by: req.user.id, approved_at: new Date() } });
  await logAudit({ user: req.user, branchId: a.branch_id, action: 'attendance.update', entity: 'Attendance', entityId: a.id, oldValue: old, newValue: a });
  res.json(a);
});

router.get('/me/summary', authorize('staff'), async (req, res) => {
  if (!req.user.staff_id) return res.json({});
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const list = await prisma.attendance.findMany({ where: { staff_id: req.user.staff_id, date: { gte: from, lt: to } } });
  const summary = list.reduce((acc, a) => {
    acc.total += 1;
    acc[a.status] = (acc[a.status] || 0) + 1;
    acc.overtime_hours += Number(a.overtime_hours || 0);
    return acc;
  }, { total: 0, overtime_hours: 0 });
  res.json({ month, year, summary, records: list });
});

module.exports = router;
