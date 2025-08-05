
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const prisma = new PrismaClient();

router.use(authenticateToken, isAdmin);

router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

router.get('/transactions', async (req, res) => {
  const transactions = await prisma.transaction.findMany({
    include: { fromUser: true, toUser: true }
  });
  res.json(transactions);
});

router.delete('/user/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.user.delete({ where: { id } });
  res.json({ message: 'User deleted' });
});

router.patch('/freeze/:id', async (req, res) => {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  const updated = await prisma.user.update({
    where: { id },
    data: { isFrozen: !user.isFrozen }
  });
  res.json({ message: `User ${updated.isFrozen ? 'frozen' : 'unfrozen'}` });
});

module.exports = router;
