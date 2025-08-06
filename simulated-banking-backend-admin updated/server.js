require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Allow frontend and admin panel access
const allowedOrigins = [
  'https://wells-fargo-online-banking.vercel.app',
  'https://admin-frontend-2h92r9pm2-victors-projects-865c1228.vercel.app'
];

// CORS setup
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Parse JSON requests
app.use(express.json());

// Optional log for debugging
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url} from ${req.headers.origin}`);
  next();
});

// Routes
const authRoutes = require('./routes/auth');
const bankRoutes = require('./routes/bank');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/admin', adminRoutes);

// Default route
app.get('/', (req, res) => {
  res.send('Simulated Banking API is running 🚀');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
