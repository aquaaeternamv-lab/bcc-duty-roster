const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', async (req, res) => {
  const list = await prisma.notification.findMany({
    where: { user_id: req.user.id },
    orderBy: { created_at: 'desc' },
    take: 100,
  });
  res.json(list);
});

router.get('/unread-count', async (req, res) => {
  const count = await prisma.notification.count({ where: { user_id: req.user.id, read_at: null } });
  res.json({ count });
});

router.post('/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, user_id: req.user.id }, data: { read_at: new Date() } });
  res.json({ ok: true });
});

router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { user_id: req.user.id, read_at: null }, data: { read_at: new Date() } });
  res.json({ ok: true });
});

module.exports = router;
