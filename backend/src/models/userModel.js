const dbImport = (() => {
  try {
    return require('../config/db');
  } catch (error) {
    return require('../db');
  }
})();

// Safely extract the pool instance
const pool = dbImport.pool || dbImport.db || dbImport;

/**
 * Fetch a user by email address
 * @param {string} email 
 * @returns {Promise<Object|null>}
 */
async function getUserByEmail(email) {
  const query = `
    SELECT
      id,
      email,
      password_hash,
      full_name,
      role
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
async function createUser({ email, password_hash, full_name, role = 'venue_staff' }) {
  const query = `
    INSERT INTO users (email, password_hash, full_name, role)
    VALUES ($1, $2, $3, $4)
    RETURNING id, email, full_name, role
  `;

  const values = [email, password_hash, full_name, role];
  const result = await pool.query(query, values);
  return result.rows[0];
}

module.exports = {
  getUserByEmail,
  getUserById,
  createUser
};