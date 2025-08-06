const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();

// 💸 POST /api/transfer - Transfer funds between users
router.post('/', authenticateToken, async (req, res) => {
  const { toEmail, amount } = req.body;

  if (!toEmail || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid recipient or amount' });
  }

  try {
    const sender = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    const receiver = await prisma.user.findUnique({
      where: { email: toEmail }
    });

    if (!receiver) return res.status(404).json({ error: 'Recipient not found' });
    if (sender.id === receiver.id) return res.status(400).json({ error: 'Cannot transfer to self' });
    if (sender.balance < amount) return res.status(400).json({ error: 'Insufficient funds' });

    // Execute transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: sender.id },
        data: { balance: { decrement: amount } }
      }),
      prisma.user.update({
        where: { id: receiver.id },
        data: { balance: { increment: amount } }
      }),
      prisma.transaction.create({
        data: {
          fromId: sender.id,
          toId: receiver.id,
          amount: parseFloat(amount)
        }
      })
    ]);

    res.json({ message: 'Transfer successful' });
  } catch (err) {
    console.error('Transfer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
