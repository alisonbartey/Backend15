const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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

// 🔐 REGISTER - Create new account with default accounts
router.post('/register', [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phone').optional().trim(),
  validate
], async (req, res) => {
  const { name, email, password, phone } = req.body;

  try {
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user with accounts in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          name,
          email: email.toLowerCase(),
          password: hashedPassword,
          phone,
          role: 'USER',
          isVerified: true,
          balance: 0
        }
      });

      // Create checking account
      const checking = await tx.account.create({
        data: {
          userId: user.id,
          accountType: 'checking',
          accountNumber: generateAccountNumber(),
          balance: 0,
          availableBalance: 0,
          currency: 'USD',
          status: 'active',
          nickname: 'Everyday Checking'
        }
      });

      // Create savings account (closed for demo)
      const savings = await tx.account.create({
        data: {
          userId: user.id,
          accountType: 'savings',
          accountNumber: generateAccountNumber(),
          balance: 0,
          availableBalance: 0,
          currency: 'USD',
          status: 'closed',
          nickname: 'Way2Save Savings'
        }
      });

      return { user, checking, savings };
    });

    const { user, checking, savings } = result;

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Send welcome email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Welcome to Wells Fargo!',
        html: `
          <h2>Welcome, ${user.name}!</h2>
          <p>Your account has been successfully created.</p>
          <p><strong>Account Numbers:</strong></p>
          <ul>
            <li>Checking: ...${checking.accountNumber.slice(-4)}</li>
            <li>Savings: ...${savings.accountNumber.slice(-4)}</li>
          </ul>
          <p>Start banking with confidence!</p>
        `
      });
    } catch (err) {
      console.error('Welcome email failed:', err.message);
    }

    console.log(`✅ User registered: ${email}`);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        accounts: {
          checking: {
            id: checking.id,
            number: maskAccountNumber(checking.accountNumber),
            balance: checking.balance
          },
          savings: {
            id: savings.id,
            number: maskAccountNumber(savings.accountNumber),
            balance: savings.balance,
            status: savings.status
          }
        }
      }
    });

  } catch (error) {
    console.error('🔥 Registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// 🔐 LOGIN (fixed with proper name)
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists(),
  validate
], async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        accounts: {
          select: {
            id: true,
            accountType: true,
            accountNumber: true,
            balance: true,
            availableBalance: true,
            status: true,
            nickname: true,
            routingNumber: true,
          }
        }
      }
    });

    if (!user) {
      console.log('❌ Login failed: user not found');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Account has been deactivated' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('❌ Login failed: password mismatch');
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'login_failed',
          details: { reason: 'Invalid password', ip: req.ip },
          success: false
        }
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { updatedAt: new Date() }
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ Login successful for ${email}`);

    // Ensure name is used properly
    const displayName = user.name || user.email || "Customer";

    res.json({
      token,
      user: {
        id: user.id,
        name: displayName,       // always use name here
        email: user.email,
        phone: user.phone,
        photoUrl: user.photoUrl,
        createdAt: user.createdAt,
        accounts: user.accounts.map(acc => ({
          id: acc.id,
          type: acc.accountType,
          number: maskAccountNumber(acc.accountNumber),
          fullNumber: acc.accountNumber,
          balance: acc.balance,
          availableBalance: acc.availableBalance,
          status: acc.status,
          nickname: acc.nickname,
          routingNumber: acc.routingNumber || '121000248'
        }))
      }
    });

  } catch (error) {
    console.error('🔥 Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🙋‍♂️ GET CURRENT USER (fixed)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        accounts: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const displayName = user.name || user.email || "Customer";

    res.json({
      id: user.id,
      name: displayName,
      email: user.email,
      phone: user.phone,
      photoUrl: user.photoUrl,
      createdAt: user.createdAt,
      accounts: user.accounts.map(acc => ({
        id: acc.id,
        type: acc.accountType,
        number: maskAccountNumber(acc.accountNumber),
        fullNumber: acc.accountNumber,
        balance: acc.balance,
        availableBalance: acc.availableBalance,
        status: acc.status,
        nickname: acc.nickname,
        routingNumber: acc.routingNumber || '121000248'
      }))
    });

  } catch (error) {
    console.error('🔥 /me error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// 🔍 GET USER BY EMAIL (For transfers - lookup recipient)
router.get('/user', authenticateToken, async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email parameter required' });
  }

  // Prevent looking up self
  if (email.toLowerCase() === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot transfer to yourself' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        name: true,
        email: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    // Check if user has active account
    const account = await prisma.account.findFirst({
      where: {
        userId: user.id,
        status: 'active',
        accountType: 'checking'
      }
    });

    if (!account) {
      return res.status(404).json({ error: 'Recipient has no active account' });
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      accountId: account.id
    });

  } catch (error) {
    console.error('🔥 User lookup error:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// 🔍 GET USER BY ID (For transaction details)
router.get('/user/:id', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// 📧 FORGOT PASSWORD
router.post('/forgot-password', [
  body('email').isEmail(),
  validate
], async (req, res) => {
  const { email } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    // Always return success to prevent email enumeration
    if (user) {
      // Generate reset token
      const resetToken = jwt.sign(
        { userId: user.id, type: 'password_reset' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Save token to user
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: resetToken }
      });

      // Send reset email
      try {
        await sendEmail({
          to: user.email,
          subject: 'Password Reset - Wells Fargo',
          html: `
            <h2>Password Reset Request</h2>
            <p>Click <a href="${process.env.FRONTEND_URL}/reset-password?token=${resetToken}">here</a> to reset your password.</p>
            <p>This link expires in 1 hour.</p>
          `
        });
      } catch (err) {
        console.error('Reset email failed:', err);
      }
    }

    res.json({ 
      message: 'If an account exists, a reset link has been sent to your email' 
    });

  } catch (error) {
    res.status(500).json({ error: 'Request failed' });
  }
});

// 🔐 RESET PASSWORD
router.post('/reset-password', [
  body('token').exists(),
  body('newPassword').isLength({ min: 8 }),
  validate
], async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'password_reset') {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: decoded.userId },
      data: { 
        password: hashedPassword,
        passwordResetToken: null
      }
    });

    res.json({ message: 'Password reset successful' });

  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

// 🚪 LOGOUT (Revoke token tracking)
router.post('/logout', authenticateToken, async (req, res) => {
  // In a full implementation, add token to blacklist
  // For now, just acknowledge
  res.json({ message: 'Logged out successfully' });
});

// Helper functions
function generateAccountNumber() {
  // Generate 10-digit account number starting with 7
  return '7' + Math.floor(Math.random() * 900000000 + 100000000).toString();
}

function maskAccountNumber(number) {
  return '...' + number.slice(-4);
}

module.exports = router;
