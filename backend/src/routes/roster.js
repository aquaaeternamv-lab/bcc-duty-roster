const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');
const { notifyRoles, notifyUsers } = require('../utils/notify');
const { generateRoster } = require('../utils/rosterGenerator');

router.use(authenticate);

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0..6
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// List rosters
router.get('/', async (req, res) => {
  const branchId = scopeBranch(req, req.query.branch_id);
  const where = branchId ? { branch_id: branchId } : {};
  if (req.query.status) where.status = req.query.status;
  const rosters = await prisma.roster.findMany({ where, orderBy: { week_start: 'desc' }, include: { branch: true } });
  res.json(rosters);
});

// Get roster + duties
router.get('/:id', async (req, res) => {
  const r = await prisma.roster.findUnique({
    where: { id: req.params.id },
    include: { branch: true, duties: { include: { staff: true, shift_type: true }, orderBy: [{ date: 'asc' }, { start_at: 'asc' }] } },
  });
  if (!r) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, r.branch_id);
  res.json(r);
});

// Generate weekly roster (creates a draft)
router.post('/generate', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.body.branch_id);
  const week = mondayOf(req.body.week_start);
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return res.status(404).json({ error: 'Branch not found' });
  const [shiftTypes, staff, leaves] = await Promise.all([
    prisma.shiftType.findMany({ where: { branch_id: branchId, active: true } }),
    prisma.staff.findMany({ where: { branch_id: branchId, active: true } }),
    prisma.leave.findMany({ where: { staff: { branch_id: branchId }, status: 'approved' } }),
  ]);
  const dutyData = generateRoster({ branch, shiftTypes, staff, leaves, weekStart: week });

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.roster.findUnique({ where: { branch_id_week_start: { branch_id: branchId, week_start: week } } });
    if (existing && existing.status === 'locked') {
      throw Object.assign(new Error('Roster locked'), { status: 409 });
    }
    if (existing) await tx.duty.deleteMany({ where: { roster_id: existing.id } });
    const roster = existing || await tx.roster.create({
      data: { branch_id: branchId, week_start: week, status: 'draft', generated_by: req.user.id },
    });
    if (existing) await tx.roster.update({ where: { id: existing.id }, data: { status: 'draft', generated_by: req.user.id } });
    if (dutyData.length) {
      await tx.duty.createMany({
        data: dutyData.map((d) => ({ ...d, roster_id: roster.id })),
      });
    }
    return roster;
  });

  await logAudit({ user: req.user, branchId, action: 'roster.generate', entity: 'Roster', entityId: result.id, newValue: { duties: dutyData.length } });
  const full = await prisma.roster.findUnique({ where: { id: result.id }, include: { duties: { include: { staff: true, shift_type: true } } } });
  res.json(full);
});

// Manually edit a duty (assign different staff or change shift)
router.put('/duty/:dutyId', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const d = await prisma.duty.findUnique({ where: { id: req.params.dutyId }, include: { roster: true } });
  if (!d) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, d.roster.branch_id);
  if (d.roster.status === 'locked') return res.status(409).json({ error: 'Roster locked' });
  const updated = await prisma.duty.update({ where: { id: d.id }, data: req.body });
  await logAudit({ user: req.user, branchId: d.roster.branch_id, action: 'roster.duty.update', entity: 'Duty', entityId: d.id, oldValue: d, newValue: updated });
  res.json(updated);
});

router.delete('/duty/:dutyId', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const d = await prisma.duty.findUnique({ where: { id: req.params.dutyId }, include: { roster: true } });
  if (!d) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, d.roster.branch_id);
  if (d.roster.status === 'locked') return res.status(409).json({ error: 'Roster locked' });
  await prisma.duty.delete({ where: { id: d.id } });
  await logAudit({ user: req.user, branchId: d.roster.branch_id, action: 'roster.duty.delete', entity: 'Duty', entityId: d.id, oldValue: d });
  res.json({ ok: true });
});

router.post('/duty', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const { roster_id, staff_id, shift_type_id, date } = req.body;
  const roster = await prisma.roster.findUnique({ where: { id: roster_id } });
  if (!roster) return res.status(404).json({ error: 'Roster not found' });
  scopeBranch(req, roster.branch_id);
  if (roster.status === 'locked') return res.status(409).json({ error: 'Roster locked' });
  const st = await prisma.shiftType.findUnique({ where: { id: shift_type_id } });
  const startAt = new Date(`${date}T${st.start_time}:00`);
  let endAt = new Date(`${date}T${st.end_time}:00`);
  if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1);
  const d = await prisma.duty.create({ data: { roster_id, staff_id, shift_type_id, date: new Date(date), start_at: startAt, end_at: endAt, is_night: !!st.is_night } });
  await logAudit({ user: req.user, branchId: roster.branch_id, action: 'roster.duty.create', entity: 'Duty', entityId: d.id, newValue: d });
  res.status(201).json(d);
});

// Publish (notifies staff)
router.post('/:id/publish', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const r = await prisma.roster.findUnique({ where: { id: req.params.id }, include: { duties: true } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, r.branch_id);
  const updated = await prisma.roster.update({ where: { id: r.id }, data: { status: 'published', published_at: new Date() } });
  // Notify all staff in this roster
  const staffIds = [...new Set(r.duties.map((d) => d.staff_id))];
  const users = await prisma.user.findMany({ where: { staff_id: { in: staffIds } }, select: { id: true } });
  await notifyUsers(users.map((u) => u.id), {
    title: 'New roster published',
    body: `Your roster for week of ${r.week_start.toISOString().slice(0,10)} is available.`,
    url: `/staff#roster/${r.id}`,
  });
  await logAudit({ user: req.user, branchId: r.branch_id, action: 'roster.publish', entity: 'Roster', entityId: r.id, newValue: updated });
  res.json(updated);
});

router.post('/:id/lock', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const r = await prisma.roster.findUnique({ where: { id: req.params.id } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, r.branch_id);
  const updated = await prisma.roster.update({ where: { id: r.id }, data: { status: 'locked', locked_at: new Date() } });
  await logAudit({ user: req.user, branchId: r.branch_id, action: 'roster.lock', entity: 'Roster', entityId: r.id });
  res.json(updated);
});

// Staff: my upcoming duties
router.get('/me/upcoming', async (req, res) => {
  if (!req.user.staff_id) return res.json([]);
  const duties = await prisma.duty.findMany({
    where: { staff_id: req.user.staff_id, date: { gte: new Date() }, roster: { status: { in: ['published', 'locked'] } } },
    include: { shift_type: true, roster: true },
    orderBy: { start_at: 'asc' },
    take: 30,
  });
  res.json(duties);
});

module.exports = router;
