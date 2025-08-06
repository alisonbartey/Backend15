require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// ✅ Add this CORS setup BEFORE routes
app.use(cors({
  origin: ['https://wells-fargo-online-banking.vercel.app'],
  credentials: true
}));

app.use(express.json());

// 👇 Your routes
const authRoutes = require('./routes/auth');
const bankRoutes = require('./routes/bank');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
