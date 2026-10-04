// File: Applies the additive venue-management upgrade without removing existing records.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');
// Applies the transactional schema upgrade on one database connection.
async function setup() {
 const client = await pool.connect();
 try { await client.query(fs.readFileSync(path.join(__dirname, 'venueManagementSchema.sql'), 'utf8')); console.log('Venue management schema ready.'); }
 catch(error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}
if(require.main === module) setup().catch(error => { // Reports diagnostic codes without credentials or data.
 console.error(error.code || error.message); process.exitCode=1;
}).finally(() => pool.end()); // Closes the maintenance connection pool.
module.exports = { setup };
