const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

async function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token', code: 'NO_TOKEN' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { staff: true, branch: true },
    });
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid user', code: 'NO_USER' });
    req.user = user;
    req.branchId = user.branch_id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token', code: 'BAD_TOKEN' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}

// Ensures branch_manager only acts on their own branch.
// super_admin can pass any branchId. Returns the branch_id to use.
function scopeBranch(req, requestedBranchId) {
  if (req.user.role === 'super_admin') return requestedBranchId || null;
  if (req.user.role === 'branch_manager') {
    if (requestedBranchId && requestedBranchId !== req.user.branch_id) {
      const e = new Error('Cross-branch access denied');
      e.status = 403;
      throw e;
    }
    return req.user.branch_id;
  }
  // staff
  return req.user.branch_id;
}

module.exports = { authenticate, authorize, scopeBranch };
