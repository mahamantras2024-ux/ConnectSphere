require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { connectDB } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const venueRoutes = require('./routes/venueRoutes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({ origin: allowedOrigins }));

// Updated to accept base64 image strings without payload size errors
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(morgan('dev'));

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Feature Routes
app.use('/api/auth', authRoutes);
app.use('/api/venues', venueRoutes);

// 404 & Error Handling
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;

// Connect DB first, then start listening
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`ConnectSphere API listening on http://localhost:${PORT}`);
  });
});