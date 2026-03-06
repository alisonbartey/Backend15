// middleware/auth.js
const jwt = require('jsonwebtoken');

// ✅ Authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expect "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
  if (err) return res.status(403).json({ error: 'Invalid or expired token' });
  req.user = {
    id: decoded.userId,  // map userId to id
    role: decoded.role,
    email: decoded.email
  };
  next();
});
};

// ✅ Admin-only middleware
const isAdmin = (req, res, next) => {
  // Make sure authenticateToken ran first
  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

// ✅ Export both middlewares
module.exports = {
  authenticateToken,
  isAdmin
};
