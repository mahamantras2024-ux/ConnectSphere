const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Configure PostgreSQL Pool connection to match .env
const pool = new Pool({
  user: process.env.DB_USER || 'connectsphere',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'connectsphere',
  password: process.env.DB_PASSWORD || 'connectsphere',
  port: process.env.DB_PORT || 5432,
});

pool.on('connect', () => {
  console.log('PostgreSQL database connected via Pool.');
});

pool.on('error', (err) => {
  console.error('Unexpected database error on idle client:', err);
});

// Helper function to create tables if they don't exist
const initializeTables = async () => {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL DEFAULT 'User',
      role VARCHAR(50) DEFAULT 'event_coordinator',
      organisation_name VARCHAR(255),
      phone VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createVenuesTable = `
    CREATE TABLE IF NOT EXISTS venues (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      pricing VARCHAR(255),
      capacity INT NOT NULL,
      location VARCHAR(255) NOT NULL,
      mrt VARCHAR(255),
      image TEXT,
      facilities TEXT[],
      supported_layouts TEXT[],
      accessibility_features TEXT[],
      operating_hours VARCHAR(255) DEFAULT '08:00 - 22:00',
      availability_status VARCHAR(50) DEFAULT 'Available',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await pool.query(createUsersTable);
  await pool.query(createVenuesTable);
};

// Seed default Venue Staff user matching the new column names
const seedStaffUser = async () => {
  const staffEmail = 'staff@connectsphere.com';
  const existingStaff = await pool.query('SELECT * FROM users WHERE email = $1', [staffEmail]);

  if (existingStaff.rows.length === 0) {
    const hashedPassword = await bcrypt.hash('password123', 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)`,
      [staffEmail, hashedPassword, 'Venue Staff', 'venue_staff']
    );
    console.log('Default Venue Staff seeded: staff@connectsphere.com / password123');
  }
};

const connectDB = async () => {
  try {
    await pool.query('SELECT NOW()');
    await initializeTables();
    await seedStaffUser();
    console.log('PostgreSQL Database connected and initialized successfully.');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
};

// Export pool, connectDB, AND query helper required by userModel.js
module.exports = { 
  pool, 
  connectDB,
  query: (text, params) => pool.query(text, params)
};