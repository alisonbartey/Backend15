const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, isAdmin } = require('../middleware/auth');

const prisma = new PrismaClient();

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ✅ All routes require admin authentication
router.use(authenticateToken, isAdmin);

// 📊 GET /api/admin/dashboard - Admin dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalUsers,
      totalTransactions,
      totalVolume,
      activeUsers,
      frozenUsers,
      recentTransactions,
      dailyStats
    ]
