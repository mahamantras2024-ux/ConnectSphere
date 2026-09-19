const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getUserByEmail } = require('../models/userModel');

async function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      message: 'Email and password are required.'
    });
  }

  try {
    const normalizedEmail = String(email).trim();

    const user = await getUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    const isMatch = await bcrypt.compare(String(password), user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    const token = jwt.sign(
      {
        sub: user.id,
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
    return res.status(500).json({
      message: 'Unable to log in at this time.'
    });
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