const prisma = require('../lib/prisma');

async function logAudit({ user, branchId, action, entity, entityId, oldValue, newValue, reason }) {
  try {
    await prisma.auditLog.create({
      data: {
        user_id: user?.id || null,
        branch_id: branchId || null,
        action,
        entity,
        entity_id: entityId || null,
        old_value: oldValue || undefined,
        new_value: newValue || undefined,
        reason: reason || null,
      },
    });
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}

module.exports = { logAudit };
