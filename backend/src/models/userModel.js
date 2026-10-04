// File: Queries and creates user accounts and stores/consumes password-reset hashes with session-version invalidation.
const { pool } = require('../config/db');

/**
 * Fetch a user by email address
 * @param {string} email
 * @returns {Promise<Object|null>}
 */
// Fetches the account credentials, role, and session version matching an email address.
async function getUserByEmail(email) {
  const query = `
    SELECT
      id,
      email,
      password_hash,
      auth_version,
      full_name,
      role
      , COALESCE(to_jsonb(users)->'roles', '[]'::jsonb) AS roles
    FROM users
    WHERE email = $1
  `;

  const result = await pool.query(query, [email]);
  return result.rows[0] || null;
}

/**
 * Fetch a user by user ID
 * @param {number|string} id
 * @returns {Promise<Object|null>}
 */
// Fetches public account fields by ID; currently retained without a caller.
async function getUserById(id) {
  const query = `
    SELECT
      id,
      email,
      full_name,
      role
    FROM users
    WHERE id = $1
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * Create a new user record
 * @param {Object} userData
 * @returns {Promise<Object>}
 */
// Inserts a user with the supplied password hash, role, name, and optional organisation.
async function createUser({ email, password_hash, full_name, role = 'venue_staff', organisation_name = null }) {
  const query = `
    INSERT INTO users (email, password_hash, full_name, role, organisation_name)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, email, full_name, role
  `;

  const values = [email, password_hash, full_name, role, organisation_name];
  const result = await pool.query(query, values);
  return result.rows[0];
}

// Stores an external user's reset-token hash with a 15-minute expiry.
async function setPasswordReset(id, hash) {
  const result = await pool.query(`
    UPDATE users SET password_reset_hash = $2,
      password_reset_expires_at = now() + interval '15 minutes'
    WHERE id = $1 AND (role IN ('event_organiser', 'attendee') OR
      COALESCE(to_jsonb(users)->'roles', '[]'::jsonb) ?| ARRAY['event_organiser', 'attendee'])
    RETURNING id`, [id, hash]);
  return result.rows[0] || null;
}

// Clears the matching reset token after delivery failure without erasing a newer token.
async function clearPasswordReset(id, hash) {
  await pool.query(`UPDATE users SET password_reset_hash = NULL, password_reset_expires_at = NULL
    WHERE id = $1 AND password_reset_hash = $2`, [id, hash]);
}

// Atomically consumes a valid external reset token and increments the session version.
async function resetExternalPassword(hash, passwordHash) {
  // Atomic consumption prevents two simultaneous requests from reusing a link.
  const result = await pool.query(`
    UPDATE users SET password_hash = $2, password_reset_hash = NULL,
      password_reset_expires_at = NULL, auth_version = auth_version + 1
    WHERE password_reset_hash = $1 AND password_reset_expires_at > now()
      AND (role IN ('event_organiser', 'attendee') OR
        COALESCE(to_jsonb(users)->'roles', '[]'::jsonb) ?| ARRAY['event_organiser', 'attendee'])
    RETURNING id`, [hash, passwordHash]);
  return result.rows[0] || null;
}

module.exports = {
  setPasswordReset,
  clearPasswordReset,
  resetExternalPassword,
  getUserByEmail,
  getUserById,
  createUser
};
