const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');
const { notifyUsers, notifyRoles } = require('../utils/notify');
const { validateSwap } = require('../utils/swapValidator');

router.use(authenticate);

router.get('/', async (req, res) => {
  const where = {};
  if (req.user.role === 'staff') {
    where.OR = [{ requester_id: req.user.staff_id }, { receiver_id: req.user.staff_id }];
  } else if (req.user.role === 'branch_manager') {
    where.from_duty = { roster: { branch_id: req.user.branch_id } };
  }
  if (req.query.status) where.status = req.query.status;
  const swaps = await prisma.swap.findMany({
    where,
    include: {
      from_duty: { include: { shift_type: true, roster: true } },
      to_duty: { include: { shift_type: true } },
      requester: true, receiver: true,
    },
    orderBy: { created_at: 'desc' },
  });
  res.json(swaps);
});

// Staff requests a swap
router.post('/', authorize('staff'), async (req, res) => {
  const { from_duty_id, receiver_staff_id, reason } = req.body;
  const fromDuty = await prisma.duty.findUnique({ where: { id: from_duty_id }, include: { roster: true } });
  if (!fromDuty || fromDuty.staff_id !== req.user.staff_id) return res.status(403).json({ error: 'Not your duty' });
  const swap = await prisma.swap.create({
    data: {
      from_duty_id,
      requester_id: req.user.staff_id,
      receiver_id: receiver_staff_id,
      reason: reason || null,
    },
  });
  // Notify receiver
  const receiverUser = await prisma.user.findUnique({ where: { staff_id: receiver_staff_id } });
  if (receiverUser) await notifyUsers([receiverUser.id], { title: 'Swap request received', body: `${req.user.name} wants to swap a duty.`, url: '/staff#swaps' });
  await logAudit({ user: req.user, branchId: fromDuty.roster.branch_id, action: 'swap.request', entity: 'Swap', entityId: swap.id, newValue: swap });
  res.status(201).json(swap);
});

// Receiver accepts/rejects
router.post('/:id/respond', authorize('staff'), async (req, res) => {
  const { accept } = req.body;
  const swap = await prisma.swap.findUnique({ where: { id: req.params.id }, include: { from_duty: { include: { roster: true } } } });
  if (!swap) return res.status(404).json({ error: 'Not found' });
  if (swap.receiver_id !== req.user.staff_id) return res.status(403).json({ error: 'Not your request' });
  if (swap.status !== 'pending_peer') return res.status(409).json({ error: 'Already responded' });
  if (!accept) {
    const u = await prisma.swap.update({ where: { id: swap.id }, data: { status: 'peer_rejected', peer_at: new Date() } });
    await notifyUsers([(await prisma.user.findUnique({ where: { staff_id: swap.requester_id } }))?.id].filter(Boolean), { title: 'Swap declined', body: `${req.user.name} declined your swap.` });
    await logAudit({ user: req.user, branchId: swap.from_duty.roster.branch_id, action: 'swap.peer_reject', entity: 'Swap', entityId: swap.id });
    return res.json(u);
  }
  // Validate against rules
  const branch = await prisma.branch.findUnique({ where: { id: swap.from_duty.roster.branch_id } });
  const { ok, warnings } = await validateSwap(swap.from_duty, swap.receiver_id, branch);
  const u = await prisma.swap.update({
    where: { id: swap.id },
    data: { status: ok ? 'pending_manager' : 'pending_manager', peer_at: new Date(), rule_warnings: warnings },
  });
  await notifyRoles({ branchId: branch.id, roles: ['branch_manager', 'super_admin'], title: 'Swap awaiting approval', body: `Swap request needs approval. ${warnings.length ? '⚠ ' + warnings.join('; ') : ''}`, url: '/manager#swaps' });
  await logAudit({ user: req.user, branchId: branch.id, action: 'swap.peer_accept', entity: 'Swap', entityId: swap.id, newValue: { warnings } });
  res.json(u);
});

// Manager approves/rejects
router.post('/:id/decide', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const { approve, reason } = req.body;
  const swap = await prisma.swap.findUnique({ where: { id: req.params.id }, include: { from_duty: { include: { roster: true, shift_type: true } } } });
  if (!swap) return res.status(404).json({ error: 'Not found' });
  scopeBranch(req, swap.from_duty.roster.branch_id);
  if (swap.status !== 'pending_manager') return res.status(409).json({ error: 'Not awaiting decision' });
  if (!approve) {
    const u = await prisma.swap.update({ where: { id: swap.id }, data: { status: 'rejected', manager_at: new Date(), manager_id: req.user.id, reason: reason || swap.reason } });
    await logAudit({ user: req.user, branchId: swap.from_duty.roster.branch_id, action: 'swap.reject', entity: 'Swap', entityId: swap.id, reason });
    return res.json(u);
  }
  // Apply: swap staff_id on from_duty (single-leg) or both duties (two-leg)
  const updated = await prisma.$transaction(async (tx) => {
    const upd = await tx.duty.update({ where: { id: swap.from_duty_id }, data: { staff_id: swap.receiver_id, status: 'swapped' } });
    if (swap.to_duty_id) {
      await tx.duty.update({ where: { id: swap.to_duty_id }, data: { staff_id: swap.requester_id, status: 'swapped' } });
    }
    return tx.swap.update({ where: { id: swap.id }, data: { status: 'approved', manager_at: new Date(), manager_id: req.user.id } });
  });
  // Notify both
  const [reqUser, recvUser] = await Promise.all([
    prisma.user.findUnique({ where: { staff_id: swap.requester_id } }),
    prisma.user.findUnique({ where: { staff_id: swap.receiver_id } }),
  ]);
  await notifyUsers([reqUser?.id, recvUser?.id].filter(Boolean), { title: 'Swap approved', body: 'Your duty swap was approved by manager.' });
  await logAudit({ user: req.user, branchId: swap.from_duty.roster.branch_id, action: 'swap.approve', entity: 'Swap', entityId: swap.id, newValue: updated });
  res.json(updated);
});

module.exports = router;
