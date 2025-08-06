require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// ✅ Allowed frontend domains
const allowedOrigins = [
  'https://wells-fargo-online-banking.vercel.app',
  'https://admin-frontend-2h92r9pm2-victors-projects-865c1228.vercel.app'
];

// ✅ CORS middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// ✅ Parse incoming JSON
app.use(express.json());

// ✅ Log incoming requests for debugging
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url} from ${req.headers.origin || 'unknown origin'}`);
  next();
});

// ✅ Routes
const authRoutes = require('./routes/auth');
const bankRoutes = require('./routes/bank');
const adminRoutes = require('./routes/admin');
const transactionRoutes = require('./routes/transactions'); // GET /api/transactions
const transferRoutes = require('./routes/transfer');        // POST /api/transfer

app.use('/api/auth', authRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/transactions', transactionRoutes); // View sent/received transactions
app.use('/api/transfer', transferRoutes);        // Send money to another user

// ✅ Root endpoint
app.get('/', (req, res) => {
  res.send('Simulated Banking API is running 🚀');
});

// ✅ Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
