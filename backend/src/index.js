require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const apiRoutes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', apiRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ConnectSphere API listening on http://localhost:${PORT}`);
});
