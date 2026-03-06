const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { query, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// 📄 GET /api/transactions - All transactions with filtering & pagination
router.get('/', [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  query('type').optional().isIn(['sent', 'received', 'all']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('search').optional().trim().escape(),
  validate
], authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      limit = 20, 
      offset = 0, 
      type = 'all',
      startDate,
      endDate,
      search
    } = req.query;

    // Build where clause
    let whereClause = {};

    if (type === 'sent') {
      whereClause.fromId = userId;
    } else if (type === 'received') {
      whereClause.toId = userId;
    } else {
      // 'all' - both sent and received
      whereClause.OR = [
        { fromId: userId },
        { toId: userId }
      ];
    }

    // Date filtering
    if (startDate || endDate) {
      whereClause.timestamp = {};
      if (startDate) whereClause.timestamp.gte = new Date(startDate);
      if (endDate) whereClause.timestamp.lte = new Date(endDate);
    }

    // Search functionality
    if (search) {
      whereClause.AND = whereClause.AND || [];
      whereClause.AND.push({
        OR: [
          { description: { contains: search, mode: 'insensitive' } },
          { memo: { contains: search, mode: 'insensitive' } },
          { 
            fromUser: { 
              name: { contains: search, mode: 'insensitive' } 
            } 
          },
          { 
            toUser: { 
              name: { contains: search, mode: 'insensitive' } 
            } 
          }
        ]
      });
    }

    // Get total count for pagination
    const totalCount = await prisma.transaction.count({ where: whereClause });

    // Fetch transactions with all relations
    // Check authentication
if (!req.user || !req.user.id) {
  return res.status(401).json({ error: 'Not authenticated' });
}

const transactions = await prisma.transaction.findMany({
  where: {
    OR: [
      { fromUserId: req.user.id },  // ✅ Correct field name
      { toUserId: req.user.id }     // ✅ Correct field name
    ]
  },
  include: {
    fromUser: { 
      select: { 
        id: true, 
        fullName: true,  // ✅ Use fullName not name
        email: true 
      } 
    },
    toUser: { 
      select: { 
        id: true, 
        fullName: true,  // ✅ Use fullName not name
        email: true 
      } 
    }
  },
  orderBy: { createdAt: 'desc' },  // ✅ Use createdAt not timestamp
  take: 20,
  skip: 0
});

// Format response for frontend
const formatted = transactions.map(tx => ({
  id: tx.id,
  type: tx.fromUserId === req.user.id ? 'sent' : 'received',
  amount: tx.amount,
  status: tx.status,
  description: tx.description,
  memo: tx.memo,
  sender: tx.fromUser?.fullName || tx.fromUser?.email,
  receiver: tx.toUser?.fullName || tx.toUser?.email,
  timestamp: tx.createdAt  // ✅ Frontend expects timestamp
}));

res.json(formatted);

    // Format for frontend compatibility
    const formattedTransactions = transactions.map(tx => {
      const isSent = tx.fromId === userId;
      const otherParty = isSent ? tx.toUser : tx.fromUser;
      const otherAccount = isSent ? tx.toAccount : tx.fromAccount;

      return {
        id: tx.id,
        amount: parseFloat(tx.amount),
        type: isSent ? 'sent' : 'received',
        direction: isSent ? 'sent' : 'received',
        status: tx.status,
        timestamp: tx.timestamp,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
        
        // Other party info
        sender: isSent ? 'You' : (tx.fromUser?.name || 'Unknown'),
        receiver: isSent ? (tx.toUser?.name || 'Unknown') : 'You',
        senderEmail: isSent ? req.user.email : tx.fromUser?.email,
        receiverEmail: isSent ? tx.toUser?.email : req.user.email,
        otherParty: {
          id: otherParty?.id,
          name: otherParty?.name || 'Unknown',
          email: otherParty?.email
        },
        
        // Account info
        fromAccount: tx.fromAccount ? {
          id: tx.fromAccount.id,
          type: tx.fromAccount.accountType,
          number: maskAccountNumber(tx.fromAccount.accountNumber)
        } : null,
        toAccount: tx.toAccount ? {
          id: tx.toAccount.id,
          type: tx.toAccount.accountType,
          number: maskAccountNumber(tx.toAccount.accountNumber)
        } : null,
        
        // Transaction details
        transactionType: tx.transactionType,
        category: tx.category,
        description: tx.description,
        memo: tx.memo,
        isRecurring: tx.isRecurring,
        
        // Calculated fields
        displayAmount: isSent ? -Math.abs(tx.amount) : Math.abs(tx.amount),
        sign: isSent ? '-' : '+',
        color: isSent ? 'red' : 'green'
      };
    });

    // Separate for backwards compatibility with old frontend
    const sent = formattedTransactions.filter(t => t.type === 'sent');
    const received = formattedTransactions.filter(t => t.type === 'received');

    // Calculate summary stats
    const stats = {
      totalSent: sent.reduce((sum, t) => sum + parseFloat(t.amount), 0),
      totalReceived: received.reduce((sum, t) => sum + parseFloat(t.amount), 0),
      count: {
        sent: sent.length,
        received: received.length,
        total: totalCount
      }
    };

    res.json({
      transactions: formattedTransactions,
      sent,
      received,
      stats,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > (parseInt(offset) + parseInt(limit))
      }
    });

  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// 📄 GET /api/transactions/:id - Single transaction details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const transaction = await prisma.transaction.findFirst({
      where: {
        id,
        OR: [
          { fromId: userId },
          { toId: userId }
        ]
      },
      include: {
        fromUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        toUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        fromAccount: true,
        toAccount: true
      }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const isSent = transaction.fromId === userId;

    res.json({
      ...transaction,
      type: isSent ? 'sent' : 'received',
      direction: isSent ? 'sent' : 'received',
      sender: isSent ? 'You' : transaction.fromUser?.name,
      receiver: isSent ? transaction.toUser?.name : 'You',
      fromAccountNumber: transaction.fromAccount 
        ? maskAccountNumber(transaction.fromAccount.accountNumber)
        : null,
      toAccountNumber: transaction.toAccount
        ? maskAccountNumber(transaction.toAccount.accountNumber)
        : null
    });

  } catch (err) {
    console.error('Error fetching transaction:', err);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
});

// 📊 GET /api/transactions/stats/monthly - Monthly statistics
router.get('/stats/monthly', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { months = 6 } = req.query;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    const monthlyStats = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', timestamp) as month,
        SUM(CASE WHEN "fromId" = ${userId} THEN amount ELSE 0 END) as sent,
        SUM(CASE WHEN "toId" = ${userId} AND "fromId" != ${userId} THEN amount ELSE 0 END) as received,
        COUNT(CASE WHEN "fromId" = ${userId} THEN 1 END) as sent_count,
        COUNT(CASE WHEN "toId" = ${userId} AND "fromId" != ${userId} THEN 1 END) as received_count
      FROM "Transaction"
      WHERE ("fromId" = ${userId} OR "toId" = ${userId})
      AND timestamp >= ${startDate}
      GROUP BY DATE_TRUNC('month', timestamp)
      ORDER BY month DESC
    `;

    // Format the raw query results
    const formattedStats = monthlyStats.map(stat => ({
      month: stat.month.toISOString().slice(0, 7), // YYYY-MM
      sent: parseFloat(stat.sent || 0),
      received: parseFloat(stat.received || 0),
      sentCount: parseInt(stat.sent_count || 0),
      receivedCount: parseInt(stat.received_count || 0),
      netFlow: parseFloat(stat.received || 0) - parseFloat(stat.sent || 0)
    }));

    res.json({
      period: `${months} months`,
      stats: formattedStats
    });

  } catch (err) {
    console.error('Error fetching monthly stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// 📈 GET /api/transactions/stats/category - Spending by category
router.get('/stats/category', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const categoryStats = await prisma.transaction.groupBy({
      by: ['category'],
      where: {
        fromId: userId,
        timestamp: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      },
      _sum: {
        amount: true
      },
      _count: {
        id: true
      }
    });

    res.json({
      period: 'Last 30 days',
      categories: categoryStats.map(cat => ({
        category: cat.category || 'Uncategorized',
        total: parseFloat(cat._sum.amount || 0),
        count: cat._count.id
      }))
    });

  } catch (err) {
    console.error('Error fetching category stats:', err);
    res.status(500).json({ error: 'Failed to fetch category statistics' });
  }
});

// 🔍 GET /api/transactions/search - Quick search endpoint
router.get('/search/:query', authenticateToken, async (req, res) => {
  try {
    const { query } = req.params;
    const userId = req.user.id;

    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { fromId: userId },
          { toId: userId }
        ],
        OR: [
          { description: { contains: query, mode: 'insensitive' } },
          { memo: { contains: query, mode: 'insensitive' } },
          { fromUser: { name: { contains: query, mode: 'insensitive' } } },
          { toUser: { name: { contains: query, mode: 'insensitive' } } }
        ]
      },
      include: {
        fromUser: { select: { name: true, email: true } },
        toUser: { select: { name: true, email: true } }
      },
      orderBy: { timestamp: 'desc' },
      take: 10
    });

    res.json({
      query,
      results: transactions.map(tx => ({
        id: tx.id,
        amount: tx.amount,
        type: tx.fromId === userId ? 'sent' : 'received',
        timestamp: tx.timestamp,
        otherParty: tx.fromId === userId ? tx.toUser?.name : tx.fromUser?.name,
        description: tx.description
      }))
    });

  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Helper functions
function maskAccountNumber(number) {
  if (!number) return null;
  return '...' + number.slice(-4);
}

module.exports = router;
