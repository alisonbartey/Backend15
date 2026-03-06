require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { PrismaClient } = require('@prisma/client');

const app = express();

// ✅ Initialize Prisma
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

// ✅ Graceful shutdown for Prisma
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

// ✅ Security: Helmet headers
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

// ✅ Allowed frontend domains (add your new ones)
const allowedOrigins = [
  'https://wells-fargo-online-banking.vercel.app',
  'https://admin-frontend-2h92r9pm2-victors-projects-865c1228.vercel.app',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'null' // For local file:// testing
];

// ✅ CORS middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`🚫 Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ✅ Rate limiting: General API
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ✅ Rate limiting: Auth endpoints (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts, please try again later' },
});

// ✅ Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ✅ Parse incoming JSON (increased limit for base64 images)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log(`Origin: ${req.headers.origin || 'none'}`);
  next();
});

// ✅ Attach Prisma to requests (optional convenience)
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// ✅ Health check endpoint (for monitoring)
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message
    });
  }
});

// ✅ Routes
const authRoutes = require('./routes/auth');
const bankRoutes = require('./routes/bank');
const adminRoutes = require('./routes/admin');
const transactionRoutes = require('./routes/transactions');
const transferRoutes = require('./routes/transfer');
const userRoutes = require('./routes/user');

// Apply stricter rate limit to auth routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/user', userRoutes);

// ✅ Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Wells Fargo API is running 🚀',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      auth: '/api/auth',
      bank: '/api/bank',
      transactions: '/api/transactions',
      transfer: '/api/transfer',
      user: '/api/user',
      admin: '/api/admin',
      health: '/health'
    },
    documentation: 'API documentation available at /docs (coming soon)'
  });
});

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  
  // Log to database if it's a serious error
  if (err.status >= 500 || !err.status) {
    console.error(err.stack);
    
    // Optional: Log to audit system
    if (req.user?.id) {
      prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'server_error',
          details: { error: err.message, path: req.path },
          success: false,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      }).catch(console.error);
    }
  }
  
  // Don't leak error details in production
  const isDev = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(isDev && { stack: err.stack, path: req.path })
  });
});

// ✅ Start the server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📍 Allowed origins: ${allowedOrigins.length} domains`);
  console.log(`🔧 Health check: http://localhost:${PORT}/health`);
});

// ✅ Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Export for testing
module.exports = { app, prisma, server };
