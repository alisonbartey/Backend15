const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// GET /api/user/profile - Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await db.query(
      'SELECT id, name, email, phone, photo_url, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/user/profile - Update profile
router.put('/profile', authenticateToken, async (req, res) => {
  const { name, phone } = req.body;
  
  try {
    const result = await db.query(
      'UPDATE users SET name = $1, phone = $2, updated_at = NOW() WHERE id = $3 RETURNING id, name, email, phone',
      [name, phone, req.user.id]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// POST /api/user/photo - Upload profile photo
router.post('/photo', authenticateToken, async (req, res) => {
  // Integrate with Cloudinary or similar
  const { photoUrl } = req.body;
  
  try {
    await db.query(
      'UPDATE users SET photo_url = $1 WHERE id = $2',
      [photoUrl, req.user.id]
    );
    
    res.json({ photoUrl });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// PUT /api/user/password - Change password
router.put('/password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  try {
    // Verify current password
    const user = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    
    const valid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    // Hash and update new password
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, req.user.id]);
    
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Password update failed' });
  }
});

module.exports = router;
