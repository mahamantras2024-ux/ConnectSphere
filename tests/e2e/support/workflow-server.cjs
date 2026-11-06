// Runs the real CommonJS backend in Node, outside Playwright's browser-test source transformer.
const { createWorkflowFixture } = require('../../backend/support/workflowFixture');
let fixture;

/** Only this test process's IPC channel can call fixture methods; nothing is exposed as a public HTTP setup route. */
async function start() {
  fixture = await createWorkflowFixture();
  process.send({ ready: true, apiUrl: fixture.apiUrl, users: fixture.users, password: fixture.password, venueId: fixture.venueId });
  process.on('message', async ({ id, method, args }) => {
    try {
      const allowed = ['query', 'request', 'submit', 'assignAndApprove', 'book', 'equip', 'confirm', 'arrange', 'close'];
      if (!allowed.includes(method)) throw new Error('Unknown test fixture operation.');
      const result = await fixture[method](...args);
      // pg Result also contains parser functions; only the observable rows/count belong on the IPC boundary.
      process.send({ id, result: method === 'query' ? { rows: result.rows, rowCount: result.rowCount } : result });
      if (method === 'close') process.disconnect();
    } catch (error) { process.send({ id, error: error.message }); }
  });
}
start().catch(error => { process.send({ startupError: error.message }); process.disconnect(); process.exitCode = 1; });
