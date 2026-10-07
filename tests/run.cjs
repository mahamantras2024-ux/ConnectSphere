// File: Runs the central backend/frontend test suites consistently on Windows, macOS and Linux.
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const options = process.argv.slice(2);
// Maps Sprint 1 stories and Sprint 2 venue/event stories to their regression suites.
const stories = {
  // Sprint 1:
  'create-venue': ['createVenue-backend','venueValidation','createVenue','venueInteractions'],
  'view-venue': ['viewVenue-backend','venueInteractions','hourlyRate'],
  'internal-login': ['login','sharedApiRegressions','sharedUiRegressions'],
  'external-auth': ['login','externalRegistration','ExternalRegister','PasswordReset','externalPasswordReset','sharedApiRegressions','sharedUiRegressions'],
  'organiser-events': ['organiserEvents','registrationModels','sharedUiRegressions'],
  'coordinator-events': ['organiserEvents','registrationModels','sharedApiRegressions','sharedUiRegressions'],
  // Sprint 2:
  'update-venue': ['venueManagement','venueInteractions','locationAndImpact'],
  'delete-venue': ['venueManagement','venueInteractions'],
  // Sprint 2 event workflow:
  'change-request-review': ['changeRequestReview','changeRequestReview.unit','changeRequestReviewPostgres','organiserEvents','sharedUiRegressions']
};
const storyIndex = options.indexOf('story');
const storyName = storyIndex < 0 ? null : options[storyIndex + 1];
const story = stories[storyName];
// Sprint 2 AC tags keep update and delete cases separate even when they share a file.
const storyPattern = {'update-venue':'SCRUM-35','delete-venue':'SCRUM-36'}[storyName];
if (storyIndex >= 0 && (!story || options.includes('coverage'))) {
  console.error(`Use: node tests/run.cjs story <${Object.keys(stories).join('|')}> [all]. Run coverage on the full suite.`);
  process.exit(1);
}
const coverage = options.includes('coverage');
const integration = options.includes('integration');
const liveDatabase = integration || options.includes('all');
const backend = !options.includes('frontend');
const frontend = !options.includes('backend') && (!integration || coverage);
let failures = 0;
// Runs a child test process, preserving its real exit status and visible diagnostics.
function run(label, args, directory, env = {}) {
  console.log(`\n${label}\n`);
  const result = spawnSync(process.execPath, args, { cwd: path.join(root, directory), env: { ...process.env, ...env }, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) failures++;
}
if (backend) {
  const files = readdirSync(path.join(__dirname, 'backend')).filter(name => name.endsWith('.test.js')).sort()
    .filter(name => !story || story.includes(name.replace('.test.js','')) || (liveDatabase && !storyPattern && name === 'databaseAcceptance.test.js'))
    .filter(name => !integration || coverage || ['databaseAcceptance.test.js','venueManagementPostgres.test.js','changeRequestReviewPostgres.test.js'].includes(name))
    .map(name => path.join(__dirname, 'backend', name));
  const args = ['--test', ...(storyPattern ? [`--test-name-pattern=${storyPattern}`] : []), ...files];
  run('Backend tests', coverage ? [path.join(root, 'backend/node_modules/c8/bin/c8.js'), ...(options.includes('sprint-one') ? ['--config',path.join(root,'backend/.c8rc.sprint-one.json')] : []), process.execPath, ...args] : args, 'backend', { RUN_DB_TESTS: liveDatabase ? '1' : '0', NODE_ENV: 'test' });
}
if (frontend) {
  const files = story ? readdirSync(path.join(__dirname,'frontend')).filter(name => story.includes(name.replace(/\.test\.(js|jsx)$/,''))).map(name => path.join(__dirname,'frontend',name)) : [];
  run('Frontend tests', [path.join(root, 'frontend/node_modules/vitest/vitest.mjs'), 'run', ...files, ...(storyPattern ? ['--testNamePattern',storyPattern] : []), ...(coverage ? ['--coverage'] : [])], 'frontend');
}
process.exitCode = failures ? 1 : 0;
