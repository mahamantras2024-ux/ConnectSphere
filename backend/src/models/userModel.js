const pool = (() => {
  try {
    return require('../config/db');
  } catch (error) {
    return require('../db');
  }
})();

async function getUserByEmail(email) {
  const result = await pool.query(
    `
      SELECT
        id,
        email,
        password_hash,
        full_name,
        role,
        organisation_name,
        phone,
        created_at,
        updated_at
      FROM users
      WHERE email = $1
    `,
    [email]
  );

  return result.rows[0] || null;
}

module.exports = {
  getUserByEmail
};
