// Internal CLI only; deliberately not exposed by an HTTP route.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createUser } = require('../models/userModel');
const { pool } = require('../config/db');

async function provisionVenueStaff({ email, fullName, password }) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      email.trim().length > 255 || typeof fullName !== 'string' ||
      !fullName.trim() || fullName.trim().length > 255 ||
      typeof password !== 'string' || password.trim().length < 8 ||
      Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Provide a valid email, a name (up to 255 characters), and a password of at least 8 characters and at most 72 UTF-8 bytes.');
  }
  const password_hash = await bcrypt.hash(password, 10);
  try {
    return await createUser({ email: email.trim().toLowerCase(), full_name: fullName.trim(), password_hash, role: 'venue_staff' });
  } catch (error) {
    if (error.code === '23505') throw new Error('An account already exists for this email. No account was changed.');
    throw error;
  }
}

if (require.main === module) {
  provisionVenueStaff({ email: process.env.STAFF_EMAIL, fullName: process.env.STAFF_NAME, password: process.env.STAFF_PASSWORD })
    .then((user) => console.log(`Venue Staff account provisioned: ${user.email}`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { provisionVenueStaff };
