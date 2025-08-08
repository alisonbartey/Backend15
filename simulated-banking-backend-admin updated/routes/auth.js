const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');
const { sendEmail } = require('../utils/email'); // 📩 Import email utility

const prisma = new PrismaClient();

// 🔐 LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      console.log('❌ Login failed: user not found');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('❌ Login failed: password mismatch');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    console.log(`✅ Login successful for ${email}`);

    // 📧 Send login notification email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Login Notification - Wells Fargo Bank',
        html: `
          <h2>Login Alert</h2>
          <p>Hello ${user.name},</p>
          <p>Your account was just logged into on ${new Date().toLocaleString()}.</p>
          <p>If this wasn't you, please contact support immediately.</p>
          <br>
          <p>— Wells Fargo Bank Security Team</p>
        `
      });
      console.log(`📩 Login email sent to ${user.email}`);
    } catch (err) {
      console.error('⚠️ Failed to send login email:', err.message);
    }

    res.json({
      token,
      role: user.role,
      name: user.name,
      email: user.email,
      balance: user.balance
    });
  } catch (error) {
    console.error('🔥 Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🙋‍♂️ GET CURRENT USER INFO
router.get('/me', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 Authenticated user ID:', req.user.id);

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        name: true,
        email: true,
        balance: true
      }
    });

    if (!user) {
      console.log('❌ User not found in /me');
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('✅ /me success:', user.email);
    res.json(user);
  } catch (error) {
    console.error('🔥 Fetch /me error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
