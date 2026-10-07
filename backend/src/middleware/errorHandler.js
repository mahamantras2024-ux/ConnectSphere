// File: Converts errors forwarded through Express middleware into an HTTP error response.
// Central error handler — keep this last in the middleware chain.
// Logs a forwarded error and returns its status/message as a JSON response.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Internal server error.',
    error: err.message || 'Internal server error.',
  });
}

module.exports = { errorHandler };
