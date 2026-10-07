// File: Checks story selection without starting application tests or accessing the database.
// Test scope: Captures runner arguments without launching the application test suites.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Captures the commands the runner would execute for a supplied story selection.
function commands(options) {
  const calls = [];
  const fakeProcess = {argv:['node','run.cjs',...options],execPath:process.execPath,env:{},exit(code){throw new Error(`exit ${code}`);}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8'), {
    __dirname, process:fakeProcess, console:{log(){},error(){}},
    require(name) {return name === 'node:child_process' ? {spawnSync(executable,args,settings){calls.push({args,settings});return {status:0};}} : require(name);}
  });
  return calls;
}
for (const [story,ac,other] of [['update-venue','SCRUM-35','SCRUM-36'],['delete-venue','SCRUM-36','SCRUM-35']]) {
  // Test case: Captures runner commands for each Sprint 2 story and checks its UI/API suites and story-name filters are selected independently.
  test(`Sprint 2 ${ac} runner AC1 - selects only the requested story's UI and API cases`,()=>{
    const calls=commands(['story',story]);
    assert.equal(calls.length,2);
    assert.ok(calls[0].args.includes(`--test-name-pattern=${ac}`));
    assert.ok(calls[0].args.some(arg=>arg.endsWith('venueManagement.test.js')));
    assert.ok(calls[1].args.includes('--testNamePattern'));
    assert.ok(calls[1].args.includes(ac));
    assert.ok(calls[1].args.some(arg=>arg.endsWith('venueManagement.test.jsx')));
    assert.ok(calls.every(call=>!call.args.includes(other)));
    // Verify each selected suite contains tagged cases; opposite-only cases cannot match.
    for (const call of calls) {
      const names=call.args.filter(arg=>/\.test\.(js|jsx)$/.test(arg)).flatMap(file=>
        [...fs.readFileSync(file,'utf8').matchAll(/(?:it|test)\('([^']+)'/g)].map(match=>match[1]));
      assert.ok(names.some(name=>name.includes(ac)));
      assert.ok(names.some(name=>name.includes(other)&&!name.includes(ac)));
      assert.ok(names.some(name=>name.includes(ac)&&!name.includes(other)));
    }
  });
  // Test case: Checks individual story commands exclude the combined database fixture while the full all command includes it.
  test(`Sprint 2 ${ac} runner AC2 - keeps combined database fixtures in the full integration suite`,()=>{
    const [backend]=commands(['story',story,'all']);
    assert.ok(!backend.args.some(arg=>/Postgres\.test\.js$/.test(arg)));
    assert.ok(commands(['all'])[0].args.some(arg=>arg.endsWith('venueManagementPostgres.test.js')));
  });
}
// Test case: Checks create-venue preserves its Sprint 1 file selection and shared live acceptance fixture.
test('Sprint 1 runner AC3 - preserves existing story selection and shared live acceptance checks',()=>{
  const calls=commands(['story','create-venue','all']);
  assert.ok(calls[0].args.some(arg=>arg.endsWith('createVenue-backend.test.js')));
  assert.ok(calls[0].args.some(arg=>arg.endsWith('databaseAcceptance.test.js')));
  assert.ok(!calls[0].args.some(arg=>arg.startsWith('--test-name-pattern')));
  assert.ok(calls[1].args.some(arg=>arg.endsWith('createVenue.test.jsx')));
});

// Test case: Ensures consolidated stories select the retained suites and never refer to removed duplicate files.
test('Internal AC2-5 / External AC5 / Coordinator AC2 - runner selects consolidated authentication and event suites',()=>{
  const internal=commands(['story','internal-login']);
  assert.ok(internal[0].args.some(arg=>arg.endsWith('sharedApiRegressions.test.js')));
  assert.ok(internal[1].args.some(arg=>arg.endsWith('login.test.jsx')));
  const external=commands(['story','external-auth']);
  assert.ok(external[1].args.some(arg=>arg.endsWith('PasswordReset.test.jsx')));
  const coordinator=commands(['story','coordinator-events']);
  assert.ok(coordinator[0].args.some(arg=>arg.endsWith('organiserEvents.test.js')));
  const all=commands(['all']);
  for(const call of [...internal,...external,...coordinator,...all]) {
    assert.ok(!call.args.some(arg=>/pulledInternalLogin|pulledEventCoordinator|venueStaff\.test|registrationAndEventForm|backend[\\/]login\.test/.test(arg)));
  }
});

// Test case: Checks shared suite consolidation retains live selection and removes every superseded shared-suite filename.
test('Shared regression consolidation AC1 - story and integration commands use the three retained shared suites',()=>{
 const internal=commands(['story','internal-login']);
 assert.ok(internal[1].args.some(arg=>arg.endsWith('sharedUiRegressions.test.jsx')));
 const integration=commands(['integration']);
 assert.ok(integration[0].args.some(arg=>arg.endsWith('databaseAcceptance.test.js')));
 for(const call of [...internal,...integration,...commands(['all'])]) {
  assert.ok(!call.args.some(arg=>/sprintOne(?:Access|FailurePaths|AcceptancePostgres|Postgres|Edges)?\.test|workspace(?:Profiles|Navigation)\.test|dashboardDrawers\.test|postgresEvents\.test|(?:startup|databaseConfig)\.test/.test(arg)));
 }
});

// Lead AC1–AC7: feature commands select the owning tests and live mode explicitly enables isolated PostgreSQL evidence.
test('Lead AC1–AC7 - runner selects lead tests and opts into isolated assignment persistence',()=>{
  const [backend,frontend]=commands(['story','coordinator-lead']);
  assert.ok(backend.args.some(arg=>arg.endsWith('coordinatorLead.test.js')));
  assert.ok(frontend.args.some(arg=>arg.endsWith('coordinatorLead.test.jsx')));
  assert.equal(backend.settings.env.RUN_LEAD_DB,'0');
  const [live]=commands(['integration']);
  assert.ok(live.args.some(arg=>arg.endsWith('coordinatorLeadPostgres.test.js')));
  assert.equal(live.settings.env.RUN_LEAD_DB,'1');
});
