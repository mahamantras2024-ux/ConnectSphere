import '@testing-library/jest-dom/vitest';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import App from '../../frontend/src/App';
import {AuthProvider} from '../../frontend/src/context/AuthContext';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn(),put:vi.fn()}}));
let role;
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();role='event_coordinator';api.get.mockImplementation(async path=>{
  if(path==='/auth/me')return {user:{id:4,role,full_name:'Coordinator'}};
  if(path.startsWith('/events/planning-calendar'))return {events:[]};
  if(path==='/events/technical-support-staff')return {staff:[]};
  return {events:[],notifications:[],unreadCount:0};
});});
afterEach(cleanup);
/** Keeps real route protection and role navigation; only HTTP is mocked. */
function open(path){localStorage.setItem('cs_token','session');render(<MemoryRouter initialEntries={[path]}><AuthProvider><App/></AuthProvider></MemoryRouter>);}
it('Planning calendar AC1 AC3 - Coordinator navigation opens a separate planning workspace',async()=>{
  // Arrange / Act: begin in Assigned Events and follow the dedicated calendar entry.
  open('/coordinator/dashboard');fireEvent.click(await screen.findByRole('link',{name:'Planning calendar'}));
  // Assert: the actual protected route loads the calendar independently of the Find venues workspace.
  expect(await screen.findByRole('heading',{name:'Planning calendar'})).toBeVisible();
  // The dedicated route belongs inside the app's one main landmark, so screen-reader navigation stays unambiguous.
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getByRole('link',{name:'Find venues'})).toBeVisible();
  expect(screen.getByRole('link',{name:'Planning calendar'})).toHaveAttribute('aria-current','page');
  expect(screen.getByRole('link',{name:'Assigned Events'})).not.toHaveAttribute('aria-current');
  expect(await screen.findByText('No assigned events scheduled this month.')).toBeVisible();
});
it('Planning calendar AC2 - a different role cannot open the calendar by URL',async()=>{
  // Arrange / Act: direct URL access must be protected as strongly as navigation links.
  role='event_organiser';open('/coordinator/planning-calendar');
  // Assert: the protected component never requests or displays Coordinator schedules.
  // Wait for authenticated organiser navigation, not the guest navbar rendered before authentication resolves.
  await screen.findByRole('link',{name:'My Events'});
  await screen.findByRole('heading',{name:'Event Organiser Dashboard'});
  expect(screen.queryByRole('link',{name:'Planning calendar'})).not.toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'Planning calendar'})).not.toBeInTheDocument();
  expect(api.get.mock.calls.some(([path])=>path.startsWith('/events/planning-calendar'))).toBe(false);
});
