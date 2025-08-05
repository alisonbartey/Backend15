const express = require('express');
const auth = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();

router.get('/dashboard', auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      transactionsSent: true,
      transactionsReceived: true
    }
  });
  const allTxs = [...user.transactionsSent, ...user.transactionsReceived]
    .sort((a, b) => b.timestamp - a.timestamp);
  res.json({ balance: user.balance, transactions: allTxs });
});

router.post('/transfer', auth, async (req, res) => {
  const { toEmail, amount } = req.body;
  const sender = await prisma.user.findUnique({ where: { id: req.user.id } });
  const receiver = await prisma.user.findUnique({ where: { email: toEmail } });
  if (!receiver) return res.status(404).json({ message: 'Receiver not found' });
  if (sender.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: sender.id },
      data: { balance: sender.balance - amount }
    }),
    prisma.user.update({
      where: { id: receiver.id },
      data: { balance: receiver.balance + amount }
    }),
    prisma.transaction.create({
      data: {
        senderId: sender.id,
        receiverId: receiver.id,
        amount,
        type: 'debit',
        description: `Sent to ${receiver.email}`
      }
    }),
    prisma.transaction.create({
      data: {
        senderId: sender.id,
        receiverId: receiver.id,
        amount,
        type: 'credit',
        description: `Received from ${sender.email}`
      }
    })
  ]);

  res.json({ message: 'Transfer complete' });
});

module.exports = router;
