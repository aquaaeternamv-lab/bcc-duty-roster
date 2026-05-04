const prisma = require('../lib/prisma');

async function notifyUsers(userIds, { title, body, url }) {
  if (!Array.isArray(userIds) || !userIds.length) return;
  await prisma.notification.createMany({
    data: userIds.map((uid) => ({ user_id: uid, title, body, url: url || null, channel: 'in_app' })),
  });
  // TODO: email/whatsapp dispatch hook here
}

async function notifyRoles({ branchId, roles, title, body, url }) {
  const where = { active: true, role: { in: roles } };
  if (branchId) where.branch_id = branchId;
  const users = await prisma.user.findMany({ where, select: { id: true } });
  await notifyUsers(users.map((u) => u.id), { title, body, url });
}

module.exports = { notifyUsers, notifyRoles };
