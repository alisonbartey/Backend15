const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('❌ No token found in Authorization header');
    return res.sendStatus(401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ Debug logs
    console.log('📦 Decoded token:', decoded);
    console.log('🔍 Extracted userId:', decoded.userId);

    req.user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!req.user) {
      console.log('❌ User not found in database for ID:', decoded.userId);
      return res.sendStatus(403);
    }

    console.log('✅ Authenticated user:', req.user.email);
    next();
  } catch (err) {
    console.error('❗ Token verification failed:', err.message);
    res.status(403).json({ error: 'Invalid token' });
  }
}

function isAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

module.exports = { authenticateToken, isAdmin };
