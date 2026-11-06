const { fork } = require('node:child_process');
const path = require('node:path');

/** Starts a test-owned Node API and proxies only fixture operations over a private child-process channel. */
async function createBrowserFixture() {
  // Preserve undefined optional arguments and Date values instead of JSON coercing them to null/strings.
  const child = fork(path.join(__dirname, 'workflow-server.cjs'), [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced',
  });
  let sequence = 0;
  const pending = new Map();
  let diagnostics = '';
  child.stderr.on('data', data => { diagnostics += data.toString(); });
  return new Promise((resolve, reject) => {
    // A failed child rejects every waiter instead of leaving a browser test hanging until its outer timeout.
    child.on('exit', code => {
      const error = new Error(`Workflow API exited (${code}): ${diagnostics}`);
      reject(error);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    });
    child.on('message', message => {
      if (message.startupError) return reject(new Error(message.startupError));
      if (message.ready) {
        const fixture = { ...message };
        for (const method of ['query', 'request', 'submit', 'assignAndApprove', 'book', 'equip', 'confirm', 'arrange', 'close']) {
          // IDs keep independently awaited fixture operations paired with their actual child-process result.
          fixture[method] = (...args) => new Promise((resolveCall, rejectCall) => {
            const id = ++sequence;
            pending.set(id, { resolve: resolveCall, reject: rejectCall });
            child.send({ id, method, args });
          });
        }
        resolve(fixture);
      } else {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
      }
    });
  });
}
module.exports = { createBrowserFixture };
