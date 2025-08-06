const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ✅ Middleware to verify JWT and attach user
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    console.log('❌ No token provided');
    return res.sendStatus(401); // Unauthorized
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ Fetch full user from DB
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      console.log('❌ Token valid, but user not found');
      return res.sendStatus(403); // Forbidden
    }

    req.user = user; // ✅ Attach full user object to request
    next();
  } catch (err) {
    console.error('❌ Invalid token:', err.message);
    res.status(403).json({ error: 'Invalid token' }); // Forbidden
  }
}

// ✅ Middleware to check admin access
function isAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    console.log('❌ Access denied: Not an admin');
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

module.exports = { authenticateToken, isAdmin };
