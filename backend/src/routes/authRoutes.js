const express = require('express');
const router = express.Router();
const { login, register, me } = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// Route endpoints mapped to authController
router.post('/login', login);
router.post('/register', register);
router.get('/me', verifyToken, me);

module.exports = router;