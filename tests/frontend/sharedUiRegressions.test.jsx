// File: Shared UI access, navigation, account, drawer and failure-state regression checks.
// Test scope: Real routing and components; only API responses are controlled. Each describe owns its setup.
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useNavigate} from 'react-router-dom';
import {describe,afterEach,beforeEach,expect,it,vi} from 'vitest';
import App from '../../frontend/src/App';
import {AuthProvider,useAuth} from '../../frontend/src/context/AuthContext';
import {api} from '../../frontend/src/api/client';
import Modal from '../../frontend/src/components/Modal';
import Dashboard from '../../frontend/src/pages/Dashboard';
import EventDetail from '../../frontend/src/pages/events/EventDetail';
import ProtectedRoute from '../../frontend/src/components/ProtectedRoute';
import EventList from '../../frontend/src/pages/events/EventList';
import MyRegistrations from '../../frontend/src/pages/registrations/MyRegistrations';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn()}}));

// Group: sprintOne - unchanged observable behavior checks.
describe('sprintOne',()=>{
let user;
// Opens the full application with a provisioned test session.
function open(path) { localStorage.setItem('cs_token', 'test-session'); return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>); }
beforeEach(() => {
  // Resets the test session and supplies authenticated empty-workspace responses.
  localStorage.clear(); api.get.mockReset(); api.post.mockReset();
  user = { id: 8, full_name: 'Test Person', role: 'attendee', roles: ['attendee', 'venue_staff'] };
  api.get.mockImplementation(async path =>
      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user } : path === '/registrations/mine' ? { registrations: [] } : path === '/venues' ? [] : { events: [] });
});
afterEach(cleanup);
// Test case: Returns personal registration fixtures and checks stored event names/statuses in the attendee dashboard.
it('attendee dashboard displays their real registration names and statuses', async () => {
  // Verifies the login dashboard criterion through the complete application route.
  api.get.mockImplementation(async path =>
      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user } : { registrations: [{ id: 1, event_id: 17, event_name: 'Community Day', status: 'registered', proposed_date: '2026-10-15', proposed_start_time: '09:00:00' }] });
  open('/attendee/dashboard');
  expect(await screen.findByRole('heading', { name: 'Community Day' })).toBeTruthy();
  expect(screen.getByText('registered')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith('/registrations/mine', 'test-session');
});
// Test case: Fails registrations retrieval and checks an error rather than misleading empty-state feedback.
it('registration API failure is shown without claiming that the attendee has no registrations', async () => {
  // Distinguishes an unavailable data source from a genuinely empty result.
  api.get.mockImplementation(async path => {
      // Handles this operation using the surrounding screen or request state.
       if (path === '/auth/me') return { user }; throw new Error('Unable to load registrations.'); });
  open('/registrations');
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load registrations.');
  expect(screen.queryByText('No registrations yet')).toBeNull();
});
// Test case: Switches to a server-approved role and checks token replacement and the active workspace.
it('role switching replaces the token and opens only the server-approved workspace', async () => {
  // Checks the user-facing role selector, API request, token persistence, and redirect.
  open('/attendee/dashboard');
  await screen.findByRole('heading', { name: 'Attendee Dashboard' });
  api.post.mockImplementation(async () => {
      // Handles this operation using the surrounding screen or request state.
       user = { ...user, role: 'venue_staff' }; return { user, token: 'venue-session' }; });
  fireEvent.change(screen.getByLabelText('Active role'), { target: { value: 'venue_staff' } });
  expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/auth/switch-role', { role: 'venue_staff' }, 'test-session');
  expect(localStorage.getItem('cs_token')).toBe('venue-session');
});
// Test case: Fails a switch and checks the current token/workspace remain intact.
it('failed role switching retains the existing workspace and token', async () => {
  // Ensures a denied role grant cannot change client-side authority.
  open('/attendee/dashboard'); await screen.findByRole('heading', { name: 'Attendee Dashboard' });
  api.post.mockRejectedValue(new Error('This role is not assigned to your account.'));
  fireEvent.change(screen.getByLabelText('Active role'), { target: { value: 'venue_staff' } });
  expect((await screen.findByRole('alert')).textContent).toMatch(/not assigned/);
  expect(localStorage.getItem('cs_token')).toBe('test-session');
  expect(screen.getByRole('heading', { name: 'Attendee Dashboard' })).toBeTruthy();
});
// Test case: Opens an assigned but inactive role dashboard and checks active-role guards deny it without switching.
it('an inactive provisioned role cannot bypass dashboard guards without switching', async () => {
  // A multi-role attendee must explicitly activate Venue Staff before using its workspace.
  open('/venue/dashboard');
  expect(await screen.findByRole('heading', { name: 'Attendee Dashboard' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add venue' })).toBeNull();
});
// Test case: Logs out before a switch resolves and checks the late response cannot reauthenticate.
it('a role-switch response arriving after logout cannot restore the session', async () => {
  // Exercises the asynchronous logout race through the real context implementation.
  let resolve;
  api.post.mockImplementation(() =>
      // Handles this operation using the surrounding screen or request state.
      new Promise(done => {
      // Handles this operation using the surrounding screen or request state.
       resolve = done; }));
  // Exposes context actions for controlled asynchronous session testing.
  function Probe() { const auth = useAuth(); return <><span>{auth.user?.role || 'Signed out'}</span><button onClick={() =>
      // Handles this control action and updates the screen state.
      auth.switchRole('venue_staff').catch(() => {
      // Reports a failed asynchronous operation.
      })}>Switch</button><button onClick={auth.logout}>Logout</button></>; }
  localStorage.setItem('cs_token', 'test-session'); render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('attendee'); fireEvent.click(screen.getByText('Switch')); fireEvent.click(screen.getByText('Logout'));
  await act(async () =>
      // Handles this operation using the surrounding screen or request state.
      resolve({ user: { ...user, role: 'venue_staff' }, token: 'late-token' }));
  expect(screen.getByText('Signed out')).toBeTruthy(); expect(localStorage.getItem('cs_token')).toBeNull();
});
// Test case: Opens venue dialogs and presses Escape, checking closure and restored opener focus.
it('venue dialogs close on Escape and restore focus to their opening control', async () => {
  // Checks keyboard accessibility for the create-record workflow.
  user = { ...user, role: 'venue_staff' }; open('/venue/dashboard');
  const button = await screen.findByRole('button', { name: 'Add venue' }); button.focus(); fireEvent.click(button);
  expect(screen.getByRole('dialog', { name: 'Add New Venue' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
      // Handles this operation using the surrounding screen or request state.
      expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(button);
});
// Test case: Submits invalid capacity/buffers and checks visible validation errors without API writes.
it('venue creation rejects invalid capacity and time buffers without API writes', async () => {
  // Validates boundaries beyond the required-field happy path.
  user = { ...user, role: 'venue_staff' }; open('/venue/dashboard');
  fireEvent.click(await screen.findByRole('button', { name: 'Add venue' }));
  fireEvent.change(screen.getByLabelText('Capacity *'), { target: { value: '-1' } });
  fireEvent.change(screen.getByLabelText('Setup time (minutes) *'), { target: { value: '-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
  expect(screen.getByText('Enter a positive whole-number capacity.')).toBeTruthy();
  expect(screen.getByText('Enter whole minutes between 0 and 10080.')).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
});

});

// Group: sprintOneEdges - unchanged observable behavior checks.
describe('sprintOneEdges',()=>{
let user;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  user = {id:8,full_name:'Test Person',role:'event_organiser',roles:['event_organiser']};
  api.get.mockImplementation(async path => path==='/auth/me'?{user}:path==='/events'?{events:[]}:path==='/venues'?[]:{registrations:[]});
});
afterEach(() => {cleanup();vi.unstubAllGlobals();});
// Opens a component with the real authentication context and a provisioned session.
function open(component, path='/') {
  localStorage.setItem('cs_token','session');
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider>{component}</AuthProvider></MemoryRouter>);
}
// Test case: Opens unknown paths/roles and checks not-found/access guidance without placeholder tasks.
it('missing paths show the useful not-found page and unknown roles show the fallback dashboard', async () => {
  open(<App/>,'/does-not-exist');expect(await screen.findByText(/not found/i)).toBeTruthy();cleanup();
  user={...user,role:'legacy_user'};open(<App/>,'/dashboard');expect(await screen.findByRole('heading',{name:'Welcome, Test Person'})).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('no available dashboard');expect(screen.queryByText(/TODO:/)).toBeNull();
});
// Test case: Returns sparse event summaries for both roles and checks fallback name, purpose and status.
it.each(['event_coordinator','event_organiser'])('lists %s events with honest missing values', async role => {
  user={...user,role};api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{events:[{id:9}]});
  open(<App/>,role==='event_organiser'?'/organizer/events':'/events');
  expect(await screen.findByText('Untitled Event')).toBeTruthy();expect(screen.getByText('No purpose provided')).toBeTruthy();expect(screen.getByText('Draft')).toBeTruthy();
});
// Test case: Returns absent/error/late event summaries and checks distinct feedback without reopening an unmounted screen.
it('Workflow AC1 - empty, absent and failed event summaries are distinct', async () => {
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{});open(<App/>,'/organizer/events');
  expect(await screen.findByText('No draft requests.')).toBeTruthy();cleanup();
  api.get.mockImplementation(async path=>{if(path==='/auth/me')return {user};throw new Error('Database offline');});open(<App/>,'/organizer/events');
  expect((await screen.findByRole('alert')).textContent).toBe('Database offline');
});
// Test case: Returns a null event then a message-free failure and checks unavailable-record versus fallback-error feedback.
it('absent events and retrieval errors have clear independent states', async () => {
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:null});open(<App/>,'/organizer/events/7');
  expect(await screen.findByText('No event details available.')).toBeTruthy();cleanup();
  api.get.mockImplementation(async path=>{if(path==='/auth/me')return {user};throw {};});open(<App/>,'/organizer/events/7');
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load event details.');
});
// Test case: Supplies malformed/impossible dates and mixed metadata and checks unavailable labels instead of invented dates.
it.each(['invalid','2030-02-30','2030-99-01'])('invalid calendar date %s is displayed as unavailable', async date=>{
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{id:7,name:'Incomplete event',proposed_date:date,purpose:{untrusted:true},accessibility_requirements:[null,12,' ','Ramp'],status:null,registration_required:false}});
  open(<App/>,'/organizer/events/7');await screen.findByText('Incomplete event');
  expect(screen.getByText('Ramp')).toBeTruthy();expect(screen.getByText('No')).toBeTruthy();expect(screen.getAllByText('Not specified').length).toBeGreaterThan(5);
});
// Test case: Switches from record 7 to record 8 while 7 is still loading; a late answer for 7 (success or failure) must not replace record 8.
it.each([['success'],['failure']])('a late %s for a previously opened record does not replace the record now shown', async outcome => {
  // Arrange: record 7 stays pending; record 8 answers immediately. The detail view stays mounted across the switch.
  let navigate,settle7;
  function Navigator(){navigate=useNavigate();return null;}
  api.get.mockImplementation(path=>path==='/auth/me'?Promise.resolve({user})
    :path==='/events/7'?new Promise((done,bad)=>{settle7={done,bad};}):Promise.resolve({event:{id:8,name:'Current record'}}));
  localStorage.setItem('cs_token','test-session');
  // Wrapped in ProtectedRoute exactly as App does, so the page renders only once the session is restored.
  render(<MemoryRouter initialEntries={['/records/7']}><AuthProvider><Routes><Route path="/records/:id" element={<ProtectedRoute roles={[user.role]}><EventDetail/></ProtectedRoute>}/></Routes><Navigator/></AuthProvider></MemoryRouter>);
  await screen.findByText('Loading event details...');
  // Act
  act(()=>navigate('/records/8'));
  expect(await screen.findByRole('heading',{name:'Current record'})).toBeTruthy();
  await act(async()=>outcome==='success'?settle7.done({event:{id:7,name:'Stale record'}}):settle7.bad(new Error('Late error')));
  // Assert: record 8 is still shown, with no stale content or error.
  expect(screen.getByRole('heading',{name:'Current record'})).toBeTruthy();
  expect(screen.queryByText('Stale record')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});
// Test case: Returns absent/sparse registrations and checks empty-state and missing event/date labels.
it('registration summaries support absent results and absent event metadata', async()=>{
  user={...user,role:'attendee'};api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{});open(<App/>,'/registrations');await screen.findByText('No registrations yet');cleanup();
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{registrations:[{id:1,event_id:17,status:'registered'}]});open(<App/>,'/registrations');
  expect(await screen.findByRole('heading',{name:'Event #17'})).toBeTruthy();expect(screen.getByText('Date not specified')).toBeTruthy();
});
// Test case: Presses Tab/Shift+Tab/Escape and checks dialog focus wrapping, closure and restored page scrolling.
it('dialog Tab and Shift+Tab wrap focus and closing restores scrolling',()=>{
  document.body.style.overflow='auto';const close=vi.fn();const view=render(<Modal title="Test" onClose={close}><input aria-label="Field"/><button>Last</button></Modal>);
  const panel=screen.getByRole('dialog'),first=screen.getByRole('button',{name:'Close dialog'}),last=screen.getByRole('button',{name:'Last'});
  fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(first);
  last.focus();fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(first);
  first.focus();fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(last);
  panel.focus();fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(last);
  screen.getByLabelText('Field').focus();fireEvent.keyDown(document,{key:'Tab'});
  fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalledOnce();
  panel.querySelectorAll('button,input').forEach(node=>node.remove());const empty=new KeyboardEvent('keydown',{key:'Tab',cancelable:true,bubbles:true});document.dispatchEvent(empty);expect(empty.defaultPrevented).toBe(true);
  view.unmount();expect(document.body.style.overflow).toBe('auto');
});
// Test case: Starts audience-free login then logs out and checks the late response cannot restore its token.
it('login without audience and a superseded sign-in cannot restore the session',async()=>{
  let auth,finish;function Probe(){auth=useAuth();return <span>{auth.user?.role||'Signed out'}</span>;}
  api.get.mockResolvedValue({user});render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('Signed out');
  api.post.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));let pending;act(()=>{pending=auth.login('a@example.test','password123');});act(()=>auth.logout());
  await act(async()=>{finish({token:'late',user});await expect(pending).rejects.toThrow('no longer active');});
  expect(localStorage.getItem('cs_token')).toBeNull();expect(api.post.mock.calls[0][1]).toEqual({email:'a@example.test',password:'password123'});
});
// Test case: An old stored session is still being checked when the user logs out and signs in again; the old check failing late must not sign out the new session.
it('late rejected session restoration cannot clear a newer session',async()=>{
  // Arrange: restoring token "old" stays pending; the fresh sign-in returns token "new", which restores normally.
  let auth,rejectOld;function Probe(){auth=useAuth();return <span>{auth.user?.role||'Signed out'}</span>;}
  localStorage.setItem('cs_token','old');
  api.get.mockImplementation((path,token)=>token==='old'?new Promise((_,bad)=>{rejectOld=bad;}):Promise.resolve({user}));
  api.post.mockResolvedValue({token:'new',user});
  render(<AuthProvider><Probe/></AuthProvider>);
  // Act
  act(()=>auth.logout());
  await act(async()=>{await auth.login('a@example.test','password123');});
  await act(async()=>rejectOld(new Error('Old session')));
  // Assert: the new session is kept in storage and in state.
  expect(localStorage.getItem('cs_token')).toBe('new');
  expect(screen.getByText(user.role)).toBeTruthy();
});
// Test case: Logs out from an internal/legacy workspace and checks staff sign-in, readable role labels and token removal.
it('internal logout returns to staff sign-in and unknown role labels remain readable',async()=>{
 user={...user,role:'legacy_user',roles:['legacy_user','attendee']};open(<App/>,'/dashboard');await screen.findByText('Welcome, Test Person');expect(screen.getByRole('option',{name:'legacy_user'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Log out'}));expect(await screen.findByRole('button',{name:'Login'})).toBeTruthy();expect(screen.getByText(/Staff accounts/)).toBeTruthy();expect(localStorage.getItem('cs_token')).toBeNull();
});
// Test case: Logs out as attendee and checks external sign-in and token removal.
it('external logout returns to external sign-in',async()=>{
 user={...user,role:'attendee'};open(<App/>,'/attendee/dashboard');await screen.findByRole('heading',{name:'Attendee Dashboard'});fireEvent.click(screen.getByRole('button',{name:'Log out'}));expect(await screen.findByRole('heading',{name:'Sign in'})).toBeTruthy();expect(localStorage.getItem('cs_token')).toBeNull();
});
// Test case: Uses the auth hook without its provider and checks the explicit configuration error.
it('authentication consumers outside their provider fail with a clear configuration error',()=>{
 const quiet=vi.spyOn(console,'error').mockImplementation(()=>{});function Probe(){useAuth();return null;}
 expect(()=>render(<Probe/>)).toThrow('useAuth must be used within AuthProvider');quiet.mockRestore();
});
// Test case: Opens an event with absent registration settings and checks unavailable feedback rather than an assumed false value.
it('an event with no recorded registration setting is explicitly marked unavailable',async()=>{
 api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{id:7,name:'No registration setting'}});open(<App/>,'/organizer/events/7');await screen.findByText('No registration setting');
 const label=screen.getByText('Registration Required');expect(label.parentElement.textContent).toMatch(/Not specified/);
});

});

// Group: workspaceProfiles - verifies the Technical Support queue and preserves other staff workspaces.
describe('workspaceProfiles',()=>{
let user;
beforeEach(()=>{
  // Arrange the authenticated account returned by the actual session endpoint.
  localStorage.clear(); localStorage.setItem('cs_token','staff-session');vi.clearAllMocks();
  user={id:8,full_name:'Chris Lee',email:'chris@example.test',role:'technical_support',roles:['technical_support']};
  api.get.mockImplementation(async(path)=>{
    if(path === '/auth/me') return {user};
    if(path === '/events/assignments') return {events:[],coordinators:[]};
    if(path === '/events/equipment-requests') return {requests:[]};
    if(path === '/events/equipment-inventory') return {inventory:[]};
    if(path === '/events/equipment-reservations') return {requests:[],reservations:[]};
    throw new Error(`Unexpected API route: ${path}`);
  });
});
afterEach(cleanup);
// Opens the real protected route and authentication provider.
function open(path){render(<MemoryRouter initialEntries={[path]}><AuthProvider><App/></AuthProvider></MemoryRouter>);}
// Test case: Opens each internal workspace and checks its authorised screen rather than unfinished task placeholders.
it.each([
  ['technical_support','/tech-support/dashboard','Technical Support Dashboard'],
  ['event_coordinator_lead','/coordinator-lead/dashboard','Coordinator Lead Dashboard'],
  ['safety_officer','/safety/dashboard','Safety Officer Dashboard'],
])('Internal workspace AC1 - %s displays its authorised workspace',async(role,path,title)=>{
  user={...user,role,roles:[role]};open(path);
  expect(await screen.findByRole('heading',{name:title})).toBeTruthy();
  if (role === 'technical_support') {
    fireEvent.click(screen.getByRole('tab',{name:'Equipment request review'}));
    expect(screen.getByRole('heading',{name:'Pending equipment requests'})).toBeTruthy();
    expect(screen.getByText('No pending equipment requests.')).toBeTruthy();
    expect(screen.queryByText('chris@example.test')).toBeNull();
  } else if (role === 'safety_officer') {
    expect(screen.getByText('chris@example.test')).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Account details'})).toBeTruthy();
  } else {
    // AC1: the lead now has a genuine queue workspace rather than a profile-only placeholder.
    expect(await screen.findByRole('heading',{name:'Unassigned requests'})).toBeTruthy();
  }
  expect(screen.queryByText(/scheduled for a later sprint|workspace is ready/i)).toBeNull();
  const expectedCalls = role === 'event_coordinator_lead' ? ['/auth/me','/events/assignments']
    : role === 'technical_support' ? ['/auth/me','/events/equipment-requests','/events/equipment-inventory','/events/equipment-reservations'] : ['/auth/me'];
  expect(api.get.mock.calls.map(call=>call[0])).toEqual(expectedCalls);
  expect(screen.getByRole('button',{name:'Log out'})).toBeTruthy();
});
// Test case: The Technical Support queue loads even when optional profile fields are absent.
it('Internal AC1 AC5 - Technical Support queue loads without optional profile fields',async()=>{
  user={id:8,role:'technical_support'};open('/tech-support/dashboard');
  fireEvent.click(await screen.findByRole('tab',{name:'Equipment request review'}));
  expect(await screen.findByText('No pending equipment requests.')).toBeTruthy();
  expect(screen.queryByText('Not recorded')).toBeNull();
  expect(api.get).toHaveBeenCalledWith('/events/equipment-requests','staff-session');
});
// Test case: Multi-role identity stays on the active Technical Support workspace without venue-only controls.
it('Internal AC1 AC5 - multi-role Technical Support session does not gain venue controls',async()=>{
  user.roles=['technical_support','venue_staff'];open('/tech-support/dashboard');
  fireEvent.click(await screen.findByRole('tab',{name:'Equipment request review'}));
  await screen.findByRole('heading',{name:'Pending equipment requests'});
  expect(screen.getByText('No pending equipment requests.')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Add venue'})).toBeNull();
});

// Test case: Safety staff keep the existing profile fallback when the role list and identity details are absent.
it('Internal AC3 - safety workspace handles missing profile fields and roles list',async()=>{
  user={id:8,role:'safety_officer'};open('/safety/dashboard');
  await screen.findByRole('heading',{name:'Account details'});
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
  expect(screen.getByLabelText('Provisioned workspaces').textContent).toBe('Safety Officer');
});

});

// Group: workspaceNavigation - unchanged observable behavior checks.
describe('workspaceNavigation',()=>{
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();});
// Test case: Checks organiser/coordinator/attendee each have one active named tab and clicking it returns to the correct dashboard.
it.each([
  ['event_organiser','/organizer/dashboard','My Events','Event Organiser Dashboard'],
  ['event_coordinator','/coordinator/dashboard','Assigned Events','Event Coordinator Dashboard'],
  ['attendee','/attendee/dashboard','My Registrations','Attendee Dashboard'],
])('UI navigation AC1 / login AC3 - %s has one active workspace tab that returns from other pages',async(role,path,label,title)=>{
  // Arrange a real session and an empty, owner-scoped response from the API boundary.
  localStorage.setItem('cs_token','session');
  api.get.mockImplementation(async endpoint=>endpoint==='/auth/me'?{user:{id:8,full_name:'Test User',role}}:endpoint==='/registrations/mine'?{registrations:[]}:{events:[]});
  render(<MemoryRouter initialEntries={['/missing-page']}><AuthProvider><App/></AuthProvider></MemoryRouter>);
  const nav=within(await screen.findByRole('navigation',{name:'Main navigation'}));
  const link=await nav.findByRole('link',{name:label});
  expect(nav.queryByRole('link',{name:'Dashboard'})).toBeNull();
  expect(link.getAttribute('href')).toBe(path);
  // Act: use the single workspace control, rather than relying on a redirect.
  fireEvent.click(link);
  // Assert: the real role screen opens and the tab identifies the current workspace.
  expect(await screen.findByRole('heading',{name:title})).toBeTruthy();
  expect(link.getAttribute('aria-current')).toBe('page');
  expect(nav.getAllByRole('link')).toHaveLength(2); // Brand plus one workspace tab.
});

});

// Group: dashboardDrawers - unchanged observable behavior checks.
describe('dashboardDrawers',()=>{
let user, registrations;
const event = { id: 19, name: 'Neighbourhood gathering', purpose: 'Connect our community', status: 'submitted' };
beforeEach(() => {
  // Arrange a real session and routing; replace only the API boundary.
  localStorage.clear(); localStorage.setItem('cs_token', 'drawer-session'); vi.clearAllMocks();
  user = { id: 7, role: 'event_organiser', full_name: 'Avery' };
  registrations = [{ id: 1, event_id: 19, event_name: 'Community afternoon', status: 'confirmed', proposed_date: '2026-10-20', proposed_start_time: '14:00:00' }];
  api.get.mockImplementation(async path => path === '/auth/me' ? { user } : path === '/events' ? { events: [event] } : path === '/registrations/mine' ? { registrations } : { event });
});
afterEach(cleanup);
// Opens the complete application so history, protection and accessible dialogs stay real.
function open(path) { render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>); }

// Test case: Opens organiser/coordinator event drawers and checks closing returns to the originating dashboard list.
it.each([
  ['event_organiser', '/organizer/dashboard', 'Event Organiser Dashboard'],
  ['event_coordinator', '/coordinator/dashboard', 'Event Coordinator Dashboard'],
])('UI1 / Organiser AC1 / Coordinator AC1 - %s details close back to the originating dashboard', async (role, path, heading) => {
  user.role = role; open(path);
  await screen.findByRole('heading', { name: heading });
  const trigger = await screen.findByRole('link', { name: 'View details' }); trigger.focus();
  fireEvent.click(trigger);
  const drawer = await screen.findByRole('dialog', { name: 'Event details' });
  expect(await within(drawer).findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: heading })).toBeNull();
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close dialog' }));
  expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(document.body.style.overflow).not.toBe('hidden');
});

// Test case: AC3 - shows a submitted critical change request in the assigned coordinator's dashboard inbox.
it('AC3 - assigned Event Coordinator sees pending critical change details and the unchanged event', async () => {
  user = { id: 30, role: 'event_coordinator', full_name: 'Casey Coordinator' };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user }
    : path === '/events' ? { events: [event] }
      : path === '/events/change-requests' ? { changeRequests: [{ id: 501, event_id: 19, event_name: event.name, organiser_name: 'Avery', requested_changes: { expectedAttendance: 55 }, status: 'pending',
        changes: [{ field: 'expectedAttendance', label: 'Expected attendance', current: 40, requested: 55 }], arrangements: [] }] }
        : { event });
  open('/coordinator/dashboard');
  expect(await screen.findByRole('heading', { name: 'Critical change requests' })).toBeTruthy();
  // The change is shown as a Current vs Requested row (Change Request Review AC1).
  const row = (await screen.findByRole('rowheader', { name: 'Expected attendance' })).closest('tr');
  expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['40', '55']);
  expect(screen.getByText('Pending review')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'View confirmed event' }).getAttribute('href')).toBe('/events/19');
  expect(screen.getByRole('heading', { name: event.name })).toBeTruthy();
});
// Test case: Opens organiser details and checks Escape and Back dismiss the drawer without leaving its list.
it('UI1 / Organiser AC1 - Escape and Back dismiss event details without leaving the event list', async () => {
  open('/organizer/events');
  fireEvent.click(await screen.findByRole('link', { name: 'View details' }));
  await screen.findByRole('dialog'); fireEvent.keyDown(document, { key: 'Escape' });
  expect(await screen.findByRole('heading', { name: 'My Events' })).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'View details' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Back to list' }));
  expect(await screen.findByRole('heading', { name: 'My Events' })).toBeTruthy();
});
// Test case: UI1 - event details open centered and clicking the unfocused backdrop closes the popup.
it('UI1 - centered event details close when the organiser clicks outside the focused popup', async () => {
  open('/organizer/events');
  fireEvent.click(await screen.findByRole('link', { name: 'View details' }));
  const dialog = await screen.findByRole('dialog', { name: 'Event details' });
  expect(dialog.classList.contains('centered-detail-panel')).toBe(true);
  fireEvent.click(dialog);
  expect(screen.getByRole('dialog', { name: 'Event details' })).toBeTruthy();
  fireEvent.click(dialog.parentElement);
  expect(screen.queryByRole('dialog', { name: 'Event details' })).toBeNull();
  expect(await screen.findByRole('heading', { name: 'My Events' })).toBeTruthy();
});
// Test case: Fails detail retrieval and checks no private data appears and Close still works.
it('UI1 / Organiser AC4 - failed details retain a working close control and reveal no record', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [event] };
    throw new Error('Event not found.');
  });
  open('/organizer/dashboard'); fireEvent.click(await screen.findByRole('link', { name: 'View details' }));
  const drawer = await screen.findByRole('dialog');
  expect((await within(drawer).findByRole('alert')).textContent).toBe('Event not found.');
  expect(within(drawer).queryByText(event.purpose)).toBeNull();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close dialog' }));
  expect(await screen.findByRole('heading', { name: 'Event Organiser Dashboard' })).toBeTruthy();
});
// Test case: Opens attendee details from a personal registration and checks no additional event request is made.
it('UI1 / External AC7-8 - attendee details use only personal registrations and close without another event request', async () => {
  user.role = 'attendee'; open('/attendee/dashboard');
  const trigger = await screen.findByRole('button', { name: 'View registration' }); trigger.focus(); fireEvent.click(trigger);
  const drawer = screen.getByRole('dialog', { name: 'Registration details' });
  for (const text of ['Community afternoon', 'confirmed', '2026-10-20', '14:00']) expect(within(drawer).getByText(text)).toBeTruthy();
  expect(api.get.mock.calls.map(call => call[0])).toEqual(['/auth/me', '/registrations/mine']);
  fireEvent.click(within(drawer).getByRole('button', { name: 'Back to list' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
// Test case: Opens sparse registration data and checks unavailable labels instead of invented details.
it('UI1 / External AC7 - missing registration data is labelled unavailable rather than fabricated', async () => {
  user.role = 'attendee'; registrations = [{ id: 2, event_id: 20 }]; open('/registrations');
  fireEvent.click(await screen.findByRole('button', { name: 'View registration' }));
  const drawer = screen.getByRole('dialog');
  expect(within(drawer).getByRole('heading', { name: 'Event #20' })).toBeTruthy();
  expect(within(drawer).getByText('Date not specified')).toBeTruthy();
  expect(within(drawer).getAllByText('Not specified')).toHaveLength(2);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull();
});

});
