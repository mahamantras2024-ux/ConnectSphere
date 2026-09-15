const { query } = require('../config/db');

const PUBLIC_COLUMNS = 'id, email, full_name, role, organisation_name, phone, created_at';

async function create({ email, passwordHash, fullName, role, organisationName, phone }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role, organisation_name, phone)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, passwordHash, fullName, role, organisationName || null, phone || null]
  );
  return rows[0];
}

async function findByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0];
}

async function findById(id) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0];
}

async function listByRole(role) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE role = $1`, [role]);
  return rows;
}

module.exports = { create, findByEmail, findById, listByRole };
