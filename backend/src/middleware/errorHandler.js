// File: Converts errors forwarded through Express middleware into an HTTP error response.
// Central error handler — keep this last in the middleware chain.

// PostgreSQL "undefined_column" and "undefined_table": the code expects a schema the database has not been upgraded to.
const MISSING_SCHEMA_CODES = new Set(['42703', '42P01']);
const MISSING_SCHEMA_MESSAGE = 'ConnectSphere is waiting for a database update. Please try again later or contact an administrator.';

// Logs a forwarded error and returns its status/message as a JSON response.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  // A missing column/table means migrations were not applied. Users get a clear, non-technical message (raw SQL
  // details are not shown), and the log names the fix for whoever runs the server.
  if (MISSING_SCHEMA_CODES.has(err.code)) {
    console.error('Database schema is out of date: run "npm run migrate:external-events --prefix backend" to apply the latest migrations.');
    return res.status(503).json({ message: MISSING_SCHEMA_MESSAGE, error: MISSING_SCHEMA_MESSAGE, code: 'DATABASE_UPDATE_REQUIRED' });
  }
  const status = err.status || 500;
  return res.status(status).json({
    message: err.message || 'Internal server error.',
    error: err.message || 'Internal server error.',
  });
}

module.exports = { errorHandler };
