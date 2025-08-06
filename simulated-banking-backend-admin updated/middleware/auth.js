const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // ✅ Attach full user to req.user (so /me can access req.user.id)
    req.user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!req.user) return res.sendStatus(403);
    next();
  } catch (err) {
    console.error('Invalid token:', err);
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
