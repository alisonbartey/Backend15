const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { authenticateToken, isAdmin } = require('../middleware/auth');

const prisma = new PrismaClient();

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ✅ All routes require admin authentication
router.use(authenticateToken, isAdmin);

// 📊 GET /api/admin/dashboard - Admin dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalUsers,
      totalTransactions,
      totalVolume,
      activeUsers,
      pendingTransactions,
      recentTransactions
    ] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count(),
      prisma.transaction.aggregate({
        _sum: { amount: true }
      }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.transaction.count({ where: { status: 'pending' } }),
      prisma.transaction.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          fromUser: { select: { email: true, fullName: true } },
          toUser: { select: { email: true, fullName: true } }
        }
      })
    ]);

    res.json({
      stats: {
        totalUsers,
        totalTransactions,
        totalVolume: totalVolume._sum.amount || 0,
        activeUsers,
        pendingTransactions
      },
      recentTransactions
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// 👥 GET /api/admin/users - List all users
router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        isAdmin: true,
        createdAt: true,
        _count: {
          select: { transactions: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// 🔍 GET /api/admin/users/:id - Get user details
router.get('/users/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        accounts: true,
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// 🚫 POST /api/admin/users/:id/freeze - Freeze user account
router.post('/users/:id/freeze', async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    
    res.json({ message: 'User account frozen' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to freeze account' });
  }
});

// ✅ POST /api/admin/users/:id/activate - Activate user account
router.post('/users/:id/activate', async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: true }
    });
    
    res.json({ message: 'User account activated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate account' });
  }
});

// 💰 GET /api/admin/transactions - All transactions with filters
router.get('/transactions', async (req, res) => {
  const { status, startDate, endDate, limit = 50 } = req.query;
  
  try {
    const where = {};
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    
    const transactions = await prisma.transaction.findMany({
      where,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        fromUser: { select: { email: true, fullName: true } },
        toUser: { select: { email: true, fullName: true } }
      }
    });
    
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;
