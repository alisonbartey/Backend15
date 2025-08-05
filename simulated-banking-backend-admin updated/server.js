require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express(); // ✅ Define app first

// ✅ CORS config — allow Netlify frontend
app.use(cors({
  origin: 'https://mybank-admin-com.netlify.app',
  credentials: true
}));

app.use(express.json());

// ✅ Routes
const authRoutes = require('./routes/auth');
const bankRoutes = require('./routes/bank');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/admin', adminRoutes);

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
