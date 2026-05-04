const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');

router.use(authenticate);

router.get('/', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.query.branch_id);
  const where = branchId ? { branch_id: branchId } : {};
  if (req.query.entity) where.entity = req.query.entity;
  if (req.query.action) where.action = req.query.action;
  const logs = await prisma.auditLog.findMany({
    where, include: { user: { select: { name: true, email: true, role: true } }, branch: { select: { name: true } } },
    orderBy: { created_at: 'desc' }, take: parseInt(req.query.limit) || 200,
  });
  res.json(logs);
});

module.exports = router;
