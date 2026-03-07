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

// Helper to mask account numbers
function maskAccountNumber(number) {
  if (!number) return null;
  return '...' + number.slice(-4);
}

// GET /api/transactions - list transactions with filters
router.get(
  '/',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    query('type').optional().isIn(['sent', 'received', 'all']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('search').optional().trim().escape(),
    validate
  ],
  authenticateToken,
  async (req, res) => {
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

      // Build base where clause
      let whereClause = {};

      if (type === 'sent') {
        whereClause.fromUserId = userId;
      } else if (type === 'received') {
        whereClause.toUserId = userId;
      } else {
        whereClause.OR = [
          { fromUserId: userId },
          { toUserId: userId }
        ];
      }

      // Date filtering
      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) whereClause.createdAt.gte = new Date(startDate);
        if (endDate) whereClause.createdAt.lte = new Date(endDate);
      }

      // Search filtering
      if (search) {
        whereClause.AND = whereClause.AND || [];
        whereClause.AND.push({
          OR: [
            { description: { contains: search, mode: 'insensitive' } },
            { memo: { contains: search, mode: 'insensitive' } },
            { fromUser: { fullName: { contains: search, mode: 'insensitive' } } },
            { toUser: { fullName: { contains: search, mode: 'insensitive' } } }
          ]
        });
      }

      // Total count for pagination
      const totalCount = await prisma.transaction.count({ where: whereClause });

      // Fetch transactions
      const transactions = await prisma.transaction.findMany({
        where: whereClause,
        include: {
          fromUser: { select: { fullName: true, email: true } },
          toUser: { select: { fullName: true, email: true } },
          fromAccount: true,
          toAccount: true
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      });

      // Format transactions for frontend
      const formattedTransactions = transactions.map(tx => {
        const isSent = tx.fromUserId === userId;
        const otherParty = isSent ? tx.toUser : tx.fromUser;

        return {
          id: tx.id,
          amount: parseFloat(tx.amount),
          type: isSent ? 'sent' : 'received',
          status: tx.status,
          description: tx.description,
          memo: tx.memo,
          timestamp: tx.createdAt,
          sender: isSent ? 'You' : tx.fromUser?.fullName || tx.fromUser?.email,
          receiver: isSent ? tx.toUser?.fullName || tx.toUser?.email : 'You',
          senderEmail: isSent ? req.user.email : tx.fromUser?.email,
          receiverEmail: isSent ? tx.toUser?.email : req.user.email,
          fromAccount: tx.fromAccount
            ? {
                id: tx.fromAccount.id,
                type: tx.fromAccount.accountType,
                number: maskAccountNumber(tx.fromAccount.accountNumber)
              }
            : null,
          toAccount: tx.toAccount
            ? {
                id: tx.toAccount.id,
                type: tx.toAccount.accountType,
                number: maskAccountNumber(tx.toAccount.accountNumber)
              }
            : null,
          displayAmount: isSent ? -Math.abs(tx.amount) : Math.abs(tx.amount),
          sign: isSent ? '-' : '+',
          color: isSent ? 'red' : 'green'
        };
      });

      // Summary stats
      const sent = formattedTransactions.filter(t => t.type === 'sent');
      const received = formattedTransactions.filter(t => t.type === 'received');

      const stats = {
        totalSent: sent.reduce((sum, t) => sum + t.amount, 0),
        totalReceived: received.reduce((sum, t) => sum + t.amount, 0),
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
          hasMore: totalCount > offset + limit
        }
      });
    } catch (err) {
      console.error('Error fetching transactions:', err);
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  }
);

module.exports = router;
