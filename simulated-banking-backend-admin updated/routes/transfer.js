const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

const prisma = new PrismaClient();

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// 💸 POST /api/transfer - Main transfer endpoint (supports multiple types)
router.post('/', [
  body('amount').isFloat({ min: 0.01, max: 10000 }).withMessage('Amount must be between $0.01 and $10,000'),
  body('memo').optional().trim().escape().isLength({ max: 140 }),
  validate
], authenticateToken, async (req, res) => {
  const { 
    toEmail, 
    amount, 
    memo, 
    transferType = 'internal',
    accountNumber,      // For external transfers
    routingNumber,      // For external transfers
    accountName,        // For external transfers
    scheduleDate,       // For scheduled transfers
    isRecurring,        // For recurring setup
    frequency           // 'weekly', 'monthly', etc.
  } = req.body;

  const transferAmount = parseFloat(amount);
  const userId = req.user.id;

  try {
    // Get sender with accounts
    const sender = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: {
          where: { status: 'active' }
        }
      }
    });

    if (!sender || sender.isFrozen) {
      return res.status(403).json({ error: 'Account is frozen or inactive' });
    }

    // Use primary checking account
    const senderAccount = sender.accounts.find(a => a.accountType === 'checking');
    if (!senderAccount) {
      return res.status(404).json({ error: 'No active checking account found' });
    }

    // Check sufficient funds
    if (senderAccount.balance < transferAmount) {
      return res.status(400).json({ 
        error: 'Insufficient funds',
        available: senderAccount.balance,
        requested: transferAmount
      });
    }

    let result;
    let recipient = null;
    let recipientAccount = null;

    // Handle different transfer types
    switch (transferType) {
      case 'internal':
        result = await handleInternalTransfer({
          sender, senderAccount, toEmail, transferAmount, memo, prisma, req
        });
        recipient = result.recipient;
        recipientAccount = result.recipientAccount;
        break;

      case 'external':
        result = await handleExternalTransfer({
          sender, senderAccount, accountNumber, routingNumber, accountName, 
          transferAmount, memo, prisma, req
        });
        break;

      case 'wire':
        result = await handleWireTransfer({
          sender, senderAccount, accountNumber, routingNumber, accountName,
          transferAmount, memo, prisma, req
        });
        break;

      case 'scheduled':
        result = await handleScheduledTransfer({
          sender, senderAccount, toEmail, transferAmount, memo, scheduleDate,
          frequency, prisma, req
        });
        break;

      default:
        return res.status(400).json({ error: 'Invalid transfer type' });
    }

    // Send success response
    res.json({
      success: true,
      message: 'Transfer processed successfully',
      transferId: result.transactionId,
      type: transferType,
      amount: transferAmount,
      fromAccount: maskAccountNumber(senderAccount.accountNumber),
      to: result.toDescription || (recipient?.email || accountNumber),
      status: result.status || 'completed',
      newBalance: result.newBalance,
      scheduledDate: result.scheduledDate || null,
      ...(result.estimatedArrival && { estimatedArrival: result.estimatedArrival })
    });

  } catch (err) {
    console.error('Transfer error:', err);
    
    // Log failed attempt
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'transfer_failed',
        details: { 
          error: err.message, 
          toEmail, 
          amount: transferAmount,
          type: transferType 
        },
        success: false,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    }).catch(console.error);

    res.status(500).json({ 
      error: err.message || 'Transfer failed. Please try again.' 
    });
  }
});

// 🔄 Handle internal transfer (user-to-user)
async function handleInternalTransfer({ sender, senderAccount, toEmail, transferAmount, memo, prisma, req }) {
  // Find recipient
  const recipient = await prisma.user.findUnique({
    where: { email: toEmail.toLowerCase() },
    include: {
      accounts: {
        where: { 
          accountType: 'checking',
          status: 'active'
        }
      }
    }
  });

  if (!recipient) {
    throw new Error('Recipient not found');
  }

  if (recipient.id === sender.id) {
    throw new Error('Cannot transfer to yourself');
  }

  const recipientAccount = recipient.accounts[0];
  if (!recipientAccount) {
    throw new Error('Recipient has no active checking account');
  }

  // Execute atomic transaction
  const [updatedSender, updatedRecipient, transaction] = await prisma.$transaction([
    // Debit sender
    prisma.account.update({
      where: { id: senderAccount.id },
      data: {
        balance: { decrement: transferAmount },
        availableBalance: { decrement: transferAmount }
      }
    }),
    
    // Credit recipient
    prisma.account.update({
      where: { id: recipientAccount.id },
      data: {
        balance: { increment: transferAmount },
        availableBalance: { increment: transferAmount }
      }
    }),
    
    // Create transaction record
    prisma.transaction.create({
      data: {
        fromId: sender.id,
        toId: recipient.id,
        fromAccountId: senderAccount.id,
        toAccountId: recipientAccount.id,
        amount: transferAmount,
        transactionType: 'internal',
        status: 'completed',
        description: memo || `Transfer to ${recipient.name || recipient.email}`,
        memo: memo,
        completedAt: new Date()
      }
    }),
    
    // Create audit log
    prisma.auditLog.create({
      data: {
        userId: sender.id,
        action: 'transfer_internal',
        details: {
          amount: transferAmount,
          toUserId: recipient.id,
          toEmail: recipient.email,
          transactionType: 'internal'
        },
        success: true,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    })
  ]);

  // Send emails (don't block response)
  sendTransferEmails(sender, recipient, transferAmount, memo, updatedSender.balance).catch(console.error);

  return {
    transactionId: transaction.id,
    recipient,
    recipientAccount,
    newBalance: updatedSender.balance,
    toDescription: recipient.email
  };
}

// 🏦 Handle external bank transfer (ACH)
async function handleExternalTransfer({ sender, senderAccount, accountNumber, routingNumber, accountName, transferAmount, memo, prisma, req }) {
  // Validate routing number
  if (!routingNumber || routingNumber.length !== 9) {
    throw new Error('Invalid routing number');
  }

  // In production: Submit to ACH network
  // For demo: Create pending transaction
  const [updatedSender, transaction] = await prisma.$transaction([
    // Hold funds (reduce available balance)
    prisma.account.update({
      where: { id: senderAccount.id },
      data: {
        availableBalance: { decrement: transferAmount }
        // Note: balance stays same until cleared
      }
    }),
    
    // Create pending transaction
    prisma.transaction.create({
      data: {
        fromId: sender.id,
        fromAccountId: senderAccount.id,
        amount: transferAmount,
        transactionType: 'external',
        status: 'pending', // Will be 'completed' after ACH clears
        description: memo || `Transfer to ${accountName || 'External Account'}`,
        memo: memo,
        // External account info stored in description for now
        // In production: link to ExternalAccount table
      }
    }),
    
    // Create external account record if new
    prisma.externalAccount.upsert({
      where: {
        // Composite unique key would be needed
        id: 'temp-' + accountNumber.slice(-4)
      },
      update: {},
      create: {
        userId: sender.id,
        accountName: accountName || 'External Account',
        bankName: 'Verified Bank',
        accountNumberHash: await hashAccountNumber(accountNumber),
        routingNumber: routingNumber,
        accountType: 'checking',
        isVerified: false
      }
    }).catch(() => null) // Ignore if table doesn't exist yet
  ]);

  // Simulate ACH processing (in production: webhook from bank)
  setTimeout(async () => {
    try {
      await prisma.$transaction([
        prisma.account.update({
          where: { id: senderAccount.id },
          data: { balance: { decrement: transferAmount } }
        }),
        prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'completed', completedAt: new Date() }
        })
      ]);
      
      // Send completion email
      await sendEmail({
        to: sender.email,
        subject: 'External Transfer Completed',
        html: `<p>Your transfer of $${transferAmount.toFixed(2)} to account ending in ...${accountNumber.slice(-4)} has completed.</p>`
      });
    } catch (err) {
      console.error('ACH completion error:', err);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours

  // Send initial email
  await sendEmail({
    to: sender.email,
    subject: 'External Transfer Initiated',
    html: `
      <h2>Transfer Initiated</h2>
      <p>Amount: $${transferAmount.toFixed(2)}</p>
      <p>To: Account ending in ...${accountNumber.slice(-4)}</p>
      <p>Estimated arrival: 1-3 business days</p>
      <p>Status: Pending</p>
    `
  });

  return {
    transactionId: transaction.id,
    newBalance: updatedSender.balance,
    toDescription: `Account ...${accountNumber.slice(-4)}`,
    status: 'pending',
    estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) // +2 days
  };
}

// ⚡ Handle wire transfer (same day)
async function handleWireTransfer({ sender, senderAccount, accountNumber, routingNumber, accountName, transferAmount, memo, prisma, req }) {
  const wireFee = 15; // Domestic wire fee
  
  if (senderAccount.balance < transferAmount + wireFee) {
    throw new Error(`Insufficient funds (includes $${wireFee} wire fee)`);
  }

  const [updatedSender, transaction] = await prisma.$transaction([
    prisma.account.update({
      where: { id: senderAccount.id },
      data: {
        balance: { decrement: transferAmount + wireFee },
        availableBalance: { decrement: transferAmount + wireFee }
      }
    }),
    
    prisma.transaction.create({
      data: {
        fromId: sender.id,
        fromAccountId: senderAccount.id,
        amount: transferAmount,
        transactionType: 'wire',
        status: 'completed', // Wires are immediate
        description: memo || `Wire to ${accountName || 'External Account'}`,
        memo: memo,
        completedAt: new Date()
      }
    }),
    
    // Fee transaction
    prisma.transaction.create({
      data: {
        fromId: sender.id,
        fromAccountId: senderAccount.id,
        amount: wireFee,
        transactionType: 'fee',
        status: 'completed',
        description: 'Wire transfer fee',
        completedAt: new Date()
      }
    })
  ]);

  await sendEmail({
    to: sender.email,
    subject: 'Wire Transfer Sent',
    html: `
      <h2>Wire Transfer Completed</h2>
      <p>Amount: $${transferAmount.toFixed(2)}</p>
      <p>Fee: $${wireFee.toFixed(2)}</p>
      <p>Total: $${(transferAmount + wireFee).toFixed(2)}</p>
      <p>To: ${accountName || 'Recipient'}</p>
      <p>Status: Completed</p>
    `
  });

  return {
    transactionId: transaction.id,
    newBalance: updatedSender.balance,
    toDescription: accountName || `Account ...${accountNumber?.slice(-4)}`,
    status: 'completed'
  };
}

// 📅 Handle scheduled transfer
async function handleScheduledTransfer({ sender, senderAccount, toEmail, transferAmount, memo, scheduleDate, frequency, prisma, req }) {
  const scheduledFor = new Date(scheduleDate);
  
  if (scheduledFor < new Date()) {
    throw new Error('Schedule date must be in the future');
  }

  // Create recurring transfer record
  const recurring = await prisma.recurringTransfer.create({
    data: {
      userId: sender.id,
      fromAccountId: senderAccount.id,
      amount: transferAmount,
      frequency: frequency || 'once',
      startDate: scheduledFor,
      nextExecutionDate: scheduledFor,
      description: memo || `Transfer to ${toEmail}`,
      isActive: true
    }
  });

  // Create pending transaction placeholder
  const transaction = await prisma.transaction.create({
    data: {
      fromId: sender.id,
      fromAccountId: senderAccount.id,
      amount: transferAmount,
      transactionType: 'internal',
      status: 'pending',
      description: `Scheduled: ${memo || 'Transfer'}`,
      scheduledAt: scheduledFor,
      isRecurring: frequency && frequency !== 'once'
    }
  });

  return {
    transactionId: transaction.id,
    scheduledDate: scheduledFor,
    recurringId: recurring.id,
    newBalance: senderAccount.balance, // No change yet
    toDescription: toEmail,
    status: 'scheduled'
  };
}

// 📧 Send transfer notification emails
async function sendTransferEmails(sender, recipient, amount, memo, newBalance) {
  // Debit alert to sender
  await sendEmail({
    to: sender.email,
    subject: 'Debit Alert - Transfer Sent',
    html: `
      <h2>Debit Alert</h2>
      <p>Hi ${sender.name || 'Customer'},</p>
      <p><strong>$${amount.toFixed(2)}</strong> has been sent to ${recipient.name || recipient.email}.</p>
      ${memo ? `<p>Memo: ${memo}</p>` : ''}
      <p>New Balance: <strong>$${newBalance.toFixed(2)}</strong></p>
      <p>Thank you for banking with Wells Fargo.</p>
      <hr>
      <p style="font-size: 12px; color: #666;">Questions? Call 1-800-869-3557</p>
    `
  });

  // Credit alert to recipient
  await sendEmail({
    to: recipient.email,
    subject: 'Credit Alert - Funds Received',
    html: `
      <h2>You've Received Money!</h2>
      <p>Hi ${recipient.name || 'Customer'},</p>
      <p><strong>$${amount.toFixed(2)}</strong> from ${sender.name || sender.email} has been deposited to your account.</p>
      ${memo ? `<p>Memo: ${memo}</p>` : ''}
      <p>View your account at <a href="#">wellsfargo.com</a></p>
    `
  });
}

// Helper functions
function maskAccountNumber(number) {
  return '...' + number.slice(-4);
}

async function hashAccountNumber(number) {
  // Simple hash for demo - use proper encryption in production
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(number).digest('hex');
}

module.exports = router;
