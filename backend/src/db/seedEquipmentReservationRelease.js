// File: Loads opt-in demo event reservations for verifying release and availability behavior in a local database.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

/** Runs only when explicitly requested so demo rows never enter a database as a migration side effect. */
async function seedEquipmentReservationRelease() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Equipment reservation demo data cannot be seeded in production.');
  }
  const sql = fs.readFileSync(path.join(__dirname, 'seeds/equipment-reservation-release.sql'), 'utf8');
  await pool.query(sql);
}

if (require.main === module) {
  seedEquipmentReservationRelease()
    .then(() => console.log('Equipment reservation release demo data is ready.'))
    .catch((error) => {
      console.error(`Unable to seed equipment reservation release demo data: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { seedEquipmentReservationRelease };
