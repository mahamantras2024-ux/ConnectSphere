// File: Creates the Express API, mounts active auth/event/venue routes, and starts database initialization when run directly.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { connectDB } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const eventRoutes = require('./routes/eventRoutes');
const venueRoutes = require('./routes/venueRoutes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({ origin: allowedOrigins }));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => // Returns the API health response without querying the database.

      // Handles this operation using the surrounding screen or request state.
      res.json({ status: 'ok' }));

// Feature Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/registrations', require('./routes/registrationRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));

// 404 & Error Handling
app.use((req, res) => // Returns the JSON 404 response for an unmatched API route.

      // Handles this operation using the surrounding screen or request state.
      res.status(404).json({ error: 'Not found.' }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;

if (require.main === module) {
  connectDB().then(() => {
    // Starts the API listener after the database initialization attempt completes.

    app.listen(PORT, () => {
      // Logs the API listening address after startup.

      console.log(`ConnectSphere API listening on http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
