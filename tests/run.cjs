// File: Runs the central backend/frontend test suites consistently on Windows, macOS and Linux.
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const options = process.argv.slice(2);
// Maps each implemented story to its shared and feature-specific regression suites.
const stories = {
  // Coordinator reporting keeps real access middleware and drawer interactions in the story suite.
  'coordinator-view-registration-information': ['coordinatorRegistrations', 'coordinatorRegistrationAccess', 'coordinatorRegistrationNavigation'],
  // Sprint 3 SCRUM-43: staff review/decisions, notifications, trusted audit and existing occupancy/concurrency guards.
  'venue-booking-approval': ['venueBookingApproval', 'venueRequestLifecycle', 'venueAvailabilityPostgres', 'venueBookingDecision'],
  // Sprint 3: SCRUM-61 requirements, multiple requests, status history and opt-in cancellation policy.
  'venue-booking-request': ['venueDiscoveryWorkflow','venueBookingRequestStory','venueBookingRequest','venueRequestRequirements','venueRequestLifecycle','venueBookingDecision','venueBookingRequestPostgres','venueBookingRequestMigration','organiserEvents'],
  // The status story covers both registration views, polling races and attendee-safe API context.
  'view-registration-status': ['viewRegistrationStatus', 'registrationStatusLabel', 'registrationResource', 'attendeeRegistration', 'attendeeEventDetails', 'attendeeEventStatus', 'attendeeWithdrawal', 'registrationModels'],
  // Withdrawal includes promotion notifications and additive migration compatibility alongside the UI/API rules.
  'withdraw-registration': ['attendeeWithdrawal', 'attendeeWithdrawalPolicy', 'attendeeWithdrawalPostgres', 'notificationMigration', 'migrateExternalEvents', 'registrationModels'],
  // Sprint 3 SCRUM-98 reuses the existing create/validation guards instead of duplicating persistence or authorization tests.
  'venue-emergency-access': ['venueEmergencyAccess','createVenue-backend','venueValidation','venueEmergencyDocuments','venueManagement','migrateExternalEvents','operationalSafetyCheck'],
  // Sprint 1:
  'create-venue': ['createVenue-backend','venueValidation','createVenue','venueInteractions'],
  'view-venue': ['viewVenue-backend','venueInteractions','hourlyRate'],
  'internal-login': ['login','sharedApiRegressions','sharedUiRegressions'],
  // Staff login and role-based access: one internal role per account, own dashboard only (Safety Officer RBAC story).
  'staff-role-access': ['staffRoleAccess','login','sharedApiRegressions','sharedUiRegressions','coordinatorLeadPostgres'],
  'external-auth': ['login','externalRegistration','ExternalRegister','PasswordReset','externalPasswordReset','sharedApiRegressions','sharedUiRegressions'],
  // Organiser reporting includes the owner-scoped API, drawer navigation and shared live-resource regressions.
  'event-organiser-registration-information': ['eventRegistrationDetails', 'registrationResource'],
  'organiser-events': ['organiserEvents','registrationModels','sharedUiRegressions'],
  'coordinator-events': ['organiserEvents','registrationModels','sharedApiRegressions','sharedUiRegressions'],
  // Sprint 2:
  // SCRUM-39: one feature suite per layer, including the authenticated search endpoint.
  'search-venues': ['venueSearch','venueDiscoveryWorkflow'],
  'update-venue': ['venueManagement','venueInteractions','locationAndImpact'],
  'delete-venue': ['venueManagement','venueInteractions'],
  // Lead workflow also retains owner/assignment and real-routing regressions.
  'coordinator-lead': ['coordinatorLead','coordinatorLeadPostgres','organiserEvents','login','sharedUiRegressions'],
  // Sprint 2 event workflow:
  'change-request-review': ['changeRequestReview','changeRequestReview.unit','changeRequestReviewPostgres','organiserEvents','sharedUiRegressions'],
  // Approve/reject decisions, Operational Safety Checks and the organiser's outcome notification.
  'event-decision': ['eventDecision','eventDecisionPolicy.unit','eventDecisionPostgres','organiserEvents','sharedUiRegressions'],
  // Operational Feasibility Check: Safety Officer facts, change requests that reopen planning stages, and re-checks.
  'operational-safety-check': ['operationalSafetyCheck','eventDecision','eventDecisionPolicy.unit','eventDecisionPostgres','venueValidation','createVenue-backend','venueManagement'],
  // Check Venue Suitability: capacity/facility rules, the coordinator API and the event-page section.
  'venue-suitability': ['venueSuitability','venueSuitability.unit','venueSuitabilityPostgres','organiserEvents','sharedUiRegressions'],
  // Coordinator tracks equipment request status: statuses, affected items, notifications and the review form.
  'equipment-status': ['equipmentStatus','equipmentStatus.unit','equipmentStatusPostgres','equipmentReviewUpgradePostgres','techSupportAssignmentGatePostgres','equipmentRequestReview','equipmentRequirements','changeRequestReview'],
  // Parent notification system: the bell and previews for every role, plus the Lead and Safety Officer triggers.
  'parent-notifications': ['parentNotifications','parentNotificationsPostgres','notificationMigration','migrateExternalEvents','equipmentStatus','eventDecision','venueBookingApproval','sharedUiRegressions'],
  // Request All Post-Submission Amendments Through the Coordinator: no direct edits after submission, amendment requests
  // with explanations, the coordinator's review, and the edit paths that now stop at submission.
  'post-submission-amendments': ['amendmentRequests','amendmentRequestsPostgres','changeRequestReview','changeRequestReviewPostgres','organiserEvents','equipmentRequirements','equipmentStatus','migrateExternalEvents','sharedUiRegressions'],
  // Record Offline Clarifications and Apply Agreed Amendments: offline records and resolution, agreed amendments with
  // their history, notifications, venue/technical/safety re-checks and deadline changes.
  'offline-clarifications-agreed-amendments': ['offlineClarifications','offlineClarificationsPostgres','agreedAmendments.unit','amendmentRequests','changeRequestReview','changeRequestReview.unit','eventDecisionPolicy.unit','venueBookingApproval','migrateExternalEvents','organiserEvents','eventDecision','sharedUiRegressions']
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
    .filter(name => !integration || coverage || ['databaseAcceptance.test.js','venueManagementPostgres.test.js','coordinatorLeadPostgres.test.js','changeRequestReviewPostgres.test.js','eventDecisionPostgres.test.js','venueSuitabilityPostgres.test.js','equipmentStatusPostgres.test.js','equipmentReviewUpgradePostgres.test.js','techSupportAssignmentGatePostgres.test.js','equipmentAlternativeAvailabilityPostgres.test.js','equipmentAvailabilityPostgres.test.js','parentNotificationsPostgres.test.js','amendmentRequestsPostgres.test.js','offlineClarificationsPostgres.test.js'].includes(name))
    .map(name => path.join(__dirname, 'backend', name));
  const args = ['--test', ...(storyPattern ? [`--test-name-pattern=${storyPattern}`] : []), ...files];
  run('Backend tests', coverage ? [path.join(root, 'backend/node_modules/c8/bin/c8.js'), ...(options.includes('sprint-one') ? ['--config',path.join(root,'backend/.c8rc.sprint-one.json')] : []), process.execPath, ...args] : args, 'backend', { RUN_DB_TESTS: liveDatabase ? '1' : '0', RUN_LEAD_DB: liveDatabase ? '1' : '0', RUN_VENUE_BOOKING_DB: liveDatabase ? '1' : '0', NODE_ENV: 'test' });
}
if (frontend) {
  const files = story ? readdirSync(path.join(__dirname,'frontend')).filter(name => story.includes(name.replace(/\.test\.(js|jsx)$/,''))).map(name => path.join(__dirname,'frontend',name)) : [];
  run('Frontend tests', [path.join(root, 'frontend/node_modules/vitest/vitest.mjs'), 'run', ...files, ...(storyPattern ? ['--testNamePattern',storyPattern] : []), ...(coverage ? ['--coverage'] : [])], 'frontend');
}
process.exitCode = failures ? 1 : 0;
