// File: Configures the PostgreSQL pool and TLS, exposes queries, and initializes the startup users/venues schema.
const { Pool } = require('pg');
const fs = require('node:fs');

// Hosted PostgreSQL uses TLS with certificate verification; local PostgreSQL can use non-TLS settings.
const ssl = process.env.DB_SSL === 'true'
  ? {
      rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA_PATH
        ? { ca: fs.readFileSync(process.env.DB_SSL_CA_PATH, 'utf8') }
        : {}),
    }
  : false;

// Configure PostgreSQL Pool connection to match .env
const pool = new Pool({
  user: process.env.DB_USER || 'connectsphere',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'connectsphere',
  password: process.env.DB_PASSWORD || 'connectsphere',
  port: process.env.DB_PORT || 5432,
  ssl,
});

pool.on('connect', () => {
  // Logs when a PostgreSQL pool connection is established.

  console.log('PostgreSQL database connected via Pool.');
});

pool.on('error', (err) => {
  // Logs an unexpected idle PostgreSQL connection error.

  console.error('Unexpected database error on idle client:', err);
});

// Helper function to create tables if they don't exist
const initializeTables = async () => {
  // Creates missing users and venues using the startup schema without upgrading existing tables.

  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL DEFAULT 'User',
      role VARCHAR(50) DEFAULT 'event_coordinator',
      roles TEXT[] NOT NULL DEFAULT '{}',
      organisation_name VARCHAR(255),
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
      setup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0),
      turnaround_minutes INTEGER NOT NULL DEFAULT 0 CHECK (turnaround_minutes >= 0),
      is_active BOOLEAN NOT NULL DEFAULT true,
      deactivated_at TIMESTAMPTZ,
      revision INTEGER NOT NULL DEFAULT 0,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      mrt_distance_m INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await pool.query(createUsersTable);
  await pool.query(createVenuesTable);
};

const connectDB = async () => {
  // Checks database connectivity and initializes startup tables, logging initialization errors.

  try {
    await pool.query('SELECT NOW()');
    await initializeTables();
    console.log('PostgreSQL Database connected and initialized successfully.');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
};

// Export pool, connectDB, AND query helper required by userModel.js
module.exports = {
  pool,
  connectDB,
  query: (text, params) => // Delegates a parameterized SQL statement to the configured PostgreSQL pool.

      // Handles this operation using the surrounding screen or request state.
      pool.query(text, params)
};
