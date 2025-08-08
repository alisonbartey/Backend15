const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');
const { Resend } = require('resend');

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to send email alerts
async function sendEmailAlert(to, subject, body) {
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM, // e.g. "Wells Fargo Alerts <alerts@yourdomain.com>"
      to,
      subject,
      html: body
    });
    console.log(`📩 Email sent to ${to}`);
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err);
  }
}

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

    // Format email HTML
    const formattedAmount = `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const date = new Date().toLocaleString();

    const debitEmail = `
      <h2>Wells Fargo Debit Alert</h2>
      <p>Hello ${sender.name},</p>
      <p>A debit of <b>${formattedAmount}</b> has been made from your account on ${date}.</p>
      <p>Recipient: ${receiver.name} (${receiver.email})</p>
      <p>If you did not authorize this transaction, please contact us immediately.</p>
      <hr>
      <small>Wells Fargo Online Banking</small>
    `;

    const creditEmail = `
      <h2>Wells Fargo Credit Alert</h2>
      <p>Hello ${receiver.name},</p>
      <p>A credit of <b>${formattedAmount}</b> has been received in your account on ${date}.</p>
      <p>Sender: ${sender.name} (${sender.email})</p>
      <p>You can view your updated balance in the Wells Fargo app or online.</p>
      <hr>
      <small>Wells Fargo Online Banking</small>
    `;

    // Send emails
    await sendEmailAlert(sender.email, 'Debit Alert', debitEmail);
    await sendEmailAlert(receiver.email, 'Credit Alert', creditEmail);

    res.json({ message: 'Transfer successful & alerts sent' });
  } catch (err) {
    console.error('Transfer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
