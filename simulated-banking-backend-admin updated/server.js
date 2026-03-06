require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const app = express();

// ✅ Security: Helmet headers
app.use(helmet({
  contentSecurityPolicy: false, // Adjust for your needs
  crossOriginEmbedderPolicy: false
}));

// ✅ Allowed frontend domains (add your new domains)
const allowedOrigins = [
  'https://wells-fargo-online-banking.vercel.app',
  'https://admin-frontend-2h92r9pm2-victors-projects-865c1228.vercel.app',
  'http://localhost:3000',     // Local development
  'http://localhost:5500',     // Live Server
  'http://127.0.0.1:5500'
];

// ✅ CORS middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`🚫 Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ✅ Rate limiting: General API
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later' }
});
app.use(generalLimiter);

// ✅ Rate limiting: Auth endpoints (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts per 15 min
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts, please try again later' }
});

// ✅ Logging
app.use(morgan('combined'));

// ✅ Parse incoming JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log(`Origin: ${req.headers.origin || 'none'}`);
  console.log(`User-Agent: ${req.headers['user-agent']?.substring(0, 50)}...`);
  next();
});

// ✅ Health check endpoint (for monitoring)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ✅ Routes
const authRoutes = require('./routes/auth');
const bankRoutes = require('./routes/bank');
const adminRoutes = require('./routes/admin');
const transactionRoutes = require('./routes/transactions');
const transferRoutes = require('./routes/transfer');
const userRoutes = require('./routes/user'); // NEW: Profile, settings

// Apply stricter rate limit to auth routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/user', userRoutes); // NEW

// ✅ Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Wells Fargo API is running 🚀',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      bank: '/api/bank',
      transactions: '/api/transactions',
      transfer: '/api/transfer',
      user: '/api/user'
    }
  });
});

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  
  // Don't leak error details in production
  const isDev = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(isDev && { stack: err.stack })
  });
});

// ✅ Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// ✅ Start the server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📍 Allowed origins: ${allowedOrigins.length} domains`);
});
