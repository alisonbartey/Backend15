const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();

// 📄 GET all transactions for current user (sent & received)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const sent = await prisma.transaction.findMany({
      where: { from: userId },
      include: { toUser: true }
    });

    const received = await prisma.transaction.findMany({
      where: { to: userId },
      include: { fromUser: true }
    });

    res.json({ sent, received });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
