const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { getUserByEmail } = require('../models/userModel');

async function login(req, res) {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !email.trim() ||
      typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await getUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        id: user.id,
        role: user.role,
        email: user.email
      },
      process.env.JWT_SECRET || 'connectsphere-secret',
      { expiresIn: '8h' }
    );

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Unable to log in at this time.' });
  }
}

async function getMe(req, res, next) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: No user ID found in token' });
    }

    const query = 'SELECT id, email, role, created_at FROM users WHERE id = $1';
    const { rows } = await db.query(query, [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  try {
    const user = await getUserByEmail(req.user.email);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Fetch current user error:', error);
    return res.status(500).json({ message: 'Unable to fetch current user.' });
  }
}

module.exports = { login, me };
