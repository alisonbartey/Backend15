// middleware/auth.js
const jwt = require('jsonwebtoken');

// ✅ Authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Check header exists
  if (!authHeader) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // Expect "Bearer TOKEN"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid authorization format' });
  }

  const token = parts[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Attach user to request
    req.user = {
      id: decoded.userId,
      role: decoded.role,
      email: decoded.email
    };

    next();
  });
};

// ✅ Admin-only middleware
const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  // Your token uses "role", not "isAdmin"
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

module.exports = {
  authenticateToken,
  isAdmin
};
