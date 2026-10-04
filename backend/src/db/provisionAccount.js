// File: Provides private account onboarding for the seven recognised roles without a public registration endpoint.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { allRoles } = require('../auth/roles');
// Validates account identity and roles, hashes credentials, and refuses duplicate-account overwrites.
async function provisionAccount({ email, fullName, password, roles, organisationName = null }) {
  if (typeof email !== 'string' || email.trim().length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof fullName !== 'string' || !fullName.trim() || fullName.length > 255 ||
    typeof password !== 'string' || password.trim().length < 8 || Buffer.byteLength(password, 'utf8') > 72 ||
    !Array.isArray(roles) || !roles.length || roles.some(role =>
      // Handles this operation using the surrounding screen or request state.
      !allRoles.includes(role)) ||
    (organisationName !== null && (typeof organisationName !== 'string' || organisationName.length > 255))) {
    throw new Error('Provide a valid email, name, password, and at least one recognised role.');
  }
  const allowed = [...new Set(roles)];
  const result = await pool.query(`INSERT INTO users (email, full_name, password_hash, role, roles, organisation_name)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, email, full_name, role, roles`,
  [email.trim().toLowerCase(), fullName.trim(), await bcrypt.hash(password, 10), allowed[0], allowed, organisationName?.trim() || null]);
  return result.rows[0];
}
if (require.main === module) provisionAccount({ email: process.env.ACCOUNT_EMAIL, fullName: process.env.ACCOUNT_NAME,
  password: process.env.ACCOUNT_PASSWORD, roles: (process.env.ACCOUNT_ROLES || '').split(',').map(role =>
      // Converts each record into its displayed or submitted representation.
      role.trim()),
  organisationName: process.env.ACCOUNT_ORGANISATION || null }).then(() =>
      // Applies the successfully loaded result.
      console.log('Account provisioned.')).catch(error => {
      // Reports a failed asynchronous operation.

    console.error(error.code === '23505' ? 'This account already exists; no account was changed.' : error.message); process.exitCode = 1;
  }).finally(() =>
      // Clears the pending state when the operation finishes.
      pool.end());
module.exports = { provisionAccount };
