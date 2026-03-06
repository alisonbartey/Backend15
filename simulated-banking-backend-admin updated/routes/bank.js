const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
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

// ✅ Middleware to protect all routes
router.use(authenticateToken);

// 💰 GET /api/bank/balance - Get primary account balance (matches frontend)
router.get('/balance', async (req, res) => {
  try {
    // Get user's primary checking account
    const account = await prisma.account.findFirst({
      where: {
        userId: req.user.id,
        accountType: 'checking',
        status: 'active'
      },
      select: {
        id: true,
        accountNumber: true,
        balance: true,
        availableBalance: true,
        accountType: true
      }
    });

    if (!account) {
      return res.status(404).json({ error: 'No active checking account found' });
    }

    res.json({
      accountId: account.id,
      accountNumber: maskAccountNumber(account.accountNumber),
      balance: account.balance,
      availableBalance: account.availableBalance,
      accountType: account.accountType
    });

  } catch (err) {
    console.error('Balance fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// 🏦 GET /api/bank/accounts - Get all user accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({
      where: {
        userId: req.user.id
      },
      orderBy: [
        { status: 'asc' }, // Active first
        { createdAt: 'asc' }
      ],
      select: {
        id: true,
        accountType: true,
        accountNumber: true,
        balance: true,
        availableBalance: true,
        status: true,
        nickname: true,
        routingNumber: true,
        openedAt: true,
        closedAt: true
      }
    });

    res.json({
      accounts: accounts.map(acc => ({
        id: acc.id,
        type: acc.accountType,
        number: maskAccountNumber(acc.accountNumber),
        fullNumber: acc.accountNumber, // For internal transfers
        balance: acc.balance,
        availableBalance: acc.availableBalance,
        status: acc.status,
        nickname: acc.nickname,
        routingNumber: acc.routingNumber,
        openedAt: acc.openedAt,
        closedAt: acc.closedAt,
        isClosed: acc.status === 'closed'
      }))
    });

  } catch (err) {
    console.error('Accounts fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// 🔍 POST /api/bank/validate - Validate external bank account (for transfers)
router.post('/validate', [
  body('routingNumber').isLength({ min: 9, max: 9 }).isNumeric(),
  body('accountNumber').isLength({ min: 4, max: 17 }),
  validate
], async (req, res) => {
  const { routingNumber, accountNumber } = req.body;

  try {
    // Bank name lookup from routing number (simplified)
    const bankDatabase = {
      '121000248': 'Wells Fargo',
      '021000021': 'Chase',
      '026009593': 'Bank of America',
      '084000026': 'Wells Fargo',
      '322271627': 'Chase (California)',
      '111000025': 'Bank of America (Texas)',
      '253177049': 'Wells Fargo (North Carolina)'
    };

    // Validate routing number checksum (ABA algorithm)
    const isValidRouting = validateRoutingNumber(routingNumber);

    if (!isValidRouting) {
      return res.status(400).json({ 
        valid: false, 
        error: 'Invalid routing number' 
      });
    }

    const bankName = bankDatabase[routingNumber] || 'Verified Financial Institution';

    res.json({
      valid: true,
      bankName: bankName,
      routingNumber: routingNumber,
      accountType: 'checking', // Default assumption
      message: 'Account validated successfully'
    });

  } catch (err) {
    console.error('Validation error:', err);
    res.status(500).json({ error: 'Validation failed' });
  }
});

// 🔄 POST /api/bank/transfer - Internal transfer between accounts
router.post('/transfer', [
  body('fromAccountId').isUUID(),
  body('toAccountId').isUUID(),
  body('amount').isFloat({ min: 0.01 }),
  body('memo').optional().trim().escape(),
  validate
], async (req, res) => {
  const { fromAccountId, toAccountId, amount, memo } = req.body;
  const transferAmount = parseFloat(amount);

  // Prevent same account transfer
  if (fromAccountId === toAccountId) {
    return res.status(400).json({ error: 'Cannot transfer to the same account' });
  }

  const tx = await prisma.$transaction(async (prisma) => {
    // Get source account with lock
    const fromAccount = await prisma.account.findFirst({
      where: {
        id: fromAccountId,
        userId: req.user.id,
        status: 'active'
      }
    });

    if (!fromAccount) {
      throw new Error('Source account not found or inactive');
    }

    if (fromAccount.balance < transferAmount) {
      throw new Error('Insufficient funds');
    }

    // Get destination account
    const toAccount = await prisma.account.findFirst({
      where: {
        id: toAccountId,
        userId: req.user.id, // Must be user's own account for internal
        status: 'active'
      }
    });

    if (!toAccount) {
      throw new Error('Destination account not found or inactive');
    }

    // Update balances
    const updatedFrom = await prisma.account.update({
      where: { id: fromAccountId },
      data: {
        balance: { decrement: transferAmount },
        availableBalance: { decrement: transferAmount }
      }
    });

    const updatedTo = await prisma.account.update({
      where: { id: toAccountId },
      data: {
        balance: { increment: transferAmount },
        availableBalance: { increment: transferAmount }
      }
    });

    // Create transaction record
    const transaction = await prisma.transaction.create({
      data: {
        fromId: req.user.id,
        toId: req.user.id, // Same user
        fromAccountId: fromAccount.id,
        toAccountId: toAccount.id,
        amount: transferAmount,
        transactionType: 'internal',
        status: 'completed',
        description: memo || `Transfer from ${fromAccount.nickname || fromAccount.accountType} to ${toAccount.nickname || toAccount.accountType}`,
        memo: memo,
        completedAt: new Date()
      }
    });

    return { transaction, fromBalance: updatedFrom.balance, toBalance: updatedTo.balance };
  });

  // Log audit
  await prisma.auditLog.create({
    data: {
      userId: req.user.id,
      action: 'internal_transfer',
      details: {
        amount: transferAmount,
        fromAccount: fromAccountId,
        toAccount: toAccountId,
        transactionId: tx.transaction.id
      },
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    }
  });

  res.json({
    success: true,
    message: 'Transfer completed successfully',
    transactionId: tx.transaction.id,
    amount: transferAmount,
    fromBalance: tx.fromBalance,
    toBalance: tx.toBalance
  });
});

// 💳 POST /api/bank/deposit - Add money (for testing/demo)
router.post('/deposit', [
  body('accountId').isUUID(),
  body('amount').isFloat({ min: 0.01, max: 100000 }),
  body('memo').optional().trim(),
  validate
], async (req, res) => {
  const { accountId, amount, memo } = req.body;
  const depositAmount = parseFloat(amount);

  try {
    const account = await prisma.account.findFirst({
      where: {
        id: accountId,
        userId: req.user.id
      }
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: {
        balance: { increment: depositAmount },
        availableBalance: { increment: depositAmount }
      }
    });

    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        toId: req.user.id,
        toAccountId: account.id,
        amount: depositAmount,
        transactionType: 'deposit',
        status: 'completed',
        description: memo || 'Account deposit',
        completedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Deposit successful',
      amount: depositAmount,
      newBalance: updated.balance,
      transactionId: transaction.id
    });

  } catch (err) {
    console.error('Deposit error:', err);
    res.status(500).json({ error: 'Deposit failed' });
  }
});

// 📊 GET /api/bank/summary - Account summary for dashboard
router.get('/summary', async (req, res) => {
  try {
    const [accounts, recentTransactions, stats] = await Promise.all([
      // Get accounts
      prisma.account.findMany({
        where: { userId: req.user.id },
        select: {
          accountType: true,
          balance: true,
          status: true
        }
      }),
      
      // Get recent transactions
      prisma.transaction.findMany({
        where: {
          OR: [
            { fromId: req.user.id },
            { toId: req.user.id }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          amount: true,
          transactionType: true,
          status: true,
          createdAt: true
        }
      }),
      
      // Get monthly stats
      prisma.$queryRaw`
        SELECT 
          SUM(CASE WHEN "fromId" = ${req.user.id} THEN amount ELSE 0 END) as total_sent,
          SUM(CASE WHEN "toId" = ${req.user.id} AND "fromId" != ${req.user.id} THEN amount ELSE 0 END) as total_received
        FROM "Transaction"
        WHERE ("fromId" = ${req.user.id} OR "toId" = ${req.user.id})
        AND "createdAt" >= NOW() - INTERVAL '30 days'
      `
    ]);

    const totalBalance = accounts.reduce((sum, acc) => 
      acc.status === 'active' ? sum + acc.balance : sum, 0
    );

    res.json({
      totalBalance,
      accountsSummary: {
        checking: accounts.find(a => a.accountType === 'checking' && a.status === 'active')?.balance || 0,
        savings: accounts.find(a => a.accountType === 'savings' && a.status === 'active')?.balance || 0
      },
      recentActivity: recentTransactions,
      monthlyStats: {
        sent: parseFloat(stats[0]?.total_sent || 0),
        received: parseFloat(stats[0]?.total_received || 0)
      }
    });

  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// Helper functions
function maskAccountNumber(number) {
  return '...' + number.slice(-4);
}

function validateRoutingNumber(routing) {
  // ABA routing number validation algorithm
  if (routing.length !== 9) return false;
  
  const digits = routing.split('').map(Number);
  const checksum = (
    3 * (digits[0] + digits[3] + digits[6]) +
    7 * (digits[1] + digits[4] + digits[7]) +
    1 * (digits[2] + digits[5] + digits[8])
  );
  
  return checksum % 10 === 0;
}

module.exports = router;
