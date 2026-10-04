// File: Wraps async Express handlers so rejected promises reach the shared error middleware.
// Wraps an async route handler so rejected promises are forwarded to Express's
// error handler instead of crashing the process.
module.exports = function asyncHandler(fn) {
  // Creates a wrapper that forwards async-handler promise failures to Express error middleware.

  return function wrapped(req, res, next) {
    // Invokes the wrapped request handler and forwards a rejected promise to next.

    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
