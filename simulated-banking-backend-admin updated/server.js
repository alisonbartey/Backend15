require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('./middleware/auth');

const app = express();

// ✅ Initialize Prisma (single instance)
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

// ✅ Graceful shutdown for Prisma
const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('beforeExit', async () => await prisma.$disconnect());

// ✅ Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ✅ CORS
const allowedOrigins = [
  'https://wells-fargo-online-banking.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'null'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS','PATCH'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With']
}));

// ✅ Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ✅ JSON parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ Attach Prisma to requests
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// ✅ Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15*60*1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' }
});
const authLimiter = rateLimit({
  windowMs: 15*60*1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts, try again later' }
});
app.use(generalLimiter);

// ✅ Health check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'healthy', database: 'connected', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected', error: err.message });
  }
});

// ✅ Auth routes (no token required)
const authRoutes = require('./routes/auth');
app.use('/api/auth/login', authLimiter); // stricter limit
app.use('/api/auth/register', authLimiter);
app.use('/api/auth', authRoutes);

// ✅ Protect all other /api routes
app.use('/api', (req, res, next) => {
  if (!req.path.startsWith('/auth')) authenticateToken(req, res, next);
  else next();
});

// ✅ Import other routes
const bankRoutes = require('./routes/bank');
const adminRoutes = require('./routes/admin');
const transactionRoutes = require('./routes/transactions');
const transferRoutes = require('./routes/transfer');
const userRoutes = require('./routes/user');

app.use('/api/bank', bankRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/user', userRoutes);

// ✅ Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Wells Fargo API running 🚀',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      auth: '/api/auth',
      bank: '/api/bank',
      transactions: '/api/transactions',
      transfer: '/api/transfer',
      user: '/api/user',
      admin: '/api/admin',
      health: '/health'
    }
  });
});

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path, method: req.method });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  const isDev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(isDev && { stack: err.stack, path: req.path })
  });
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔧 Health: http://localhost:${PORT}/health`);
});

// Export for testing
module.exports = { app, prisma, server };
