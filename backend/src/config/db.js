const { Pool } = require('pg');
require('dotenv').config();

// Single shared connection pool. Import `query` (or `pool` for transactions)
// wherever a model needs to talk to Postgres.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // Idle client errors — log and let the process keep running.
  console.error('Unexpected error on idle Postgres client', err);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
