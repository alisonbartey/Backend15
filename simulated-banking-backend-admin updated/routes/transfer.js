// routes/transfer.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');
const { sendEmail } = require('../utils/email'); // 📧 Import email utility

const prisma = new PrismaClient();

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

    // Send Debit Alert to Sender
    await sendEmail({
      to: sender.email,
      subject: 'Debit Alert - Transfer Successful',
      html: `
        <h2>Debit Alert</h2>
        <p>Dear ${sender.name || 'Customer'},</p>
        <p>Your account has been debited with <strong>$${amount.toFixed(2)}</strong> to ${receiver.name || receiver.email}.</p>
        <p>Available Balance: $${(sender.balance - amount).toFixed(2)}</p>
        <p>Thank you for banking with us.</p>
      `
    });

    // Send Credit Alert to Receiver
    await sendEmail({
      to: receiver.email,
      subject: 'Credit Alert - Funds Received',
      html: `
        <h2>Credit Alert</h2>
        <p>Dear ${receiver.name || 'Customer'},</p>
        <p>Your account has been credited with <strong>$${amount.toFixed(2)}</strong> from ${sender.name || sender.email}.</p>
        <p>Available Balance: $${(receiver.balance + amount).toFixed(2)}</p>
        <p>Thank you for banking with us.</p>
      `
    });

    res.json({ message: 'Transfer successful' });
  } catch (err) {
    console.error('Transfer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
