const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();

// ✅ Middleware to protect all /api/bank routes
router.use(authenticateToken);

// 💰 Get current user balance
router.get('/balance', async (req, res) => {
  res.json({ balance: req.user.balance });
});

// 🔄 Transfer money to another user
router.post('/transfer', async (req, res) => {
  const { toEmail, amount } = req.body;

  if (!toEmail || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid transfer details' });
  }

  if (req.user.isFrozen) {
    return res.status(403).json({ error: 'Account is frozen' });
  }

  const recipient = await prisma.user.findUnique({ where: { email: toEmail } });
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });
  if (recipient.id === req.user.id) return res.status(400).json({ error: 'Cannot transfer to yourself' });

  const sender = await prisma.user.findUnique({ where: { id: req.user.id } });

  if (sender.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // ✅ Perform transaction
  await prisma.$transaction([
    prisma.user.update({
      where: { id: sender.id },
      data: { balance: { decrement: amount } }
    }),
    prisma.user.update({
      where: { id: recipient.id },
      data: { balance: { increment: amount } }
    }),
    prisma.transaction.create({
      data: {
        amount,
        fromId: sender.id,
        toId: recipient.id
      }
    })
  ]);

  res.json({ message: `Transferred ₦${amount} to ${toEmail}` });
});

// 📜 Get all transactions for the logged-in user
router.get('/transactions', async (req, res) => {
  const transactions = await prisma.transaction.findMany({
    where: {
      OR: [
        { fromId: req.user.id },
        { toId: req.user.id }
      ]
    },
    include: {
      fromUser: true,
      toUser: true
    },
    orderBy: { timestamp: 'desc' }
  });

  res.json(transactions);
});

module.exports = router;
