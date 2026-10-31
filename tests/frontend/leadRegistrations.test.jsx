import '@testing-library/jest-dom/vitest';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,fireEvent,within,cleanup} from '@testing-library/react';
import LeadRegistrations from '../../frontend/src/pages/events/LeadRegistrations';
import {api} from '../../frontend/src/api/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import EventDetail from '../../frontend/src/pages/events/EventDetail';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn()}}));
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'lead',user:{id:1,role:'event_coordinator_lead'}})}));
const rows=[{id:1,attendee_name:'Alice',status:'registered'},{id:2,attendee_name:'Bob',status:'waitlisted'},
  {id:3,attendee_name:'Cara',status:'waitlisted'},{id:4,attendee_name:'Dan',status:'withdrawn'},
  {id:5,attendee_name:'Eva',status:'withdrawn'},{id:6,attendee_name:'Fran',status:'withdrawn'}];
const data={event:{id:7,name:'Workshop'},attendees:rows,waitlist:rows.slice(1,3),headcount:1,waitlist_count:2,withdrawal_count:3,venue_capacity:1,remaining_spots:0};
beforeEach(()=>{vi.resetAllMocks();api.get.mockResolvedValue(data);});afterEach(cleanup);
it('Lead registrations AC1 AC2 AC3 AC4 - drawer displays statuses counts capacity remaining spots and queue order',async()=>{
  // Arrange: report is fetched only on deliberate opening, not while browsing assignment cards.
  render(<LeadRegistrations eventId={7} token="lead"/>);expect(api.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Registration information'}));
  // Act / Assert: render server facts without changing a registered attendee into a waitlisted one.
  expect(await screen.findByRole('heading',{name:'Workshop'})).toBeVisible();
  const table=screen.getByRole('table');expect(within(table).getByText('Registered')).toBeVisible();
  expect(within(table).getAllByText('Withdrawn')).toHaveLength(3);expect(screen.getByText('Confirmed headcount').parentElement).toHaveTextContent('1');
  // Distinct counts expose accidentally binding two summary cards to the same response field.
  expect(screen.getByText('Waitlist').parentElement).toHaveTextContent('2');
  expect(screen.getByText('Withdrawals').parentElement).toHaveTextContent('3');
  expect(screen.getByText('Venue capacity:').parentElement).toHaveTextContent('Remaining spots: 0');
  expect(within(screen.getByRole('list',{name:'Waitlist queue'})).getAllByRole('listitem').map(row=>row.textContent)).toEqual(['Bob','Cara']);
  expect(api.get).toHaveBeenCalledWith('/events/7/lead-registrations','lead');
  fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('Lead registrations AC1 AC3 - an empty report with no confirmed venue stays explicit',async()=>{
  // Arrange / Act: absence of a venue must not look like a full zero-seat event.
  api.get.mockResolvedValue({...data,attendees:[],waitlist:[],headcount:0,waitlist_count:0,withdrawal_count:0,venue_capacity:null,remaining_spots:null});
  render(<LeadRegistrations eventId={7} token="lead"/>);fireEvent.click(screen.getByRole('button',{name:'Registration information'}));
  // Assert: all empty states are meaningful and no private attendee table is manufactured.
  expect(await screen.findByText('No registrations yet.')).toBeVisible();
  expect(screen.getByText('No confirmed venue capacity is available.')).toBeVisible();
  expect(screen.getByText('No attendees on the waitlist.')).toBeVisible();
});
it('Lead registrations AC5 - an access failure shows no attendee identities',async()=>{
  // Arrange / Act: the Lead may lose oversight before opening the drawer.
  api.get.mockRejectedValue(Object.assign(new Error('Outside authorised oversight'),{status:404}));
  render(<LeadRegistrations eventId={7} token="lead"/>);fireEvent.click(screen.getByRole('button',{name:'Registration information'}));
  // Assert: error handling must not render names from any previous event.
  expect(await screen.findByRole('alert')).toHaveTextContent('Outside authorised oversight');
  expect(screen.queryByText('Alice')).not.toBeInTheDocument();
});
it('Lead registrations AC1 - an authorised Lead can open registration information from event details',async()=>{
  // Arrange: keep the real event page and router so the feature is reachable outside assignment cards too.
  api.get.mockImplementation(async path=>path==='/events/7'?{event:{id:7,name:'Workshop',status:'submitted',is_draft:false,organiser_id:2}}:data);
  render(<MemoryRouter initialEntries={['/events/7']}><Routes><Route path="/events/:id" element={<EventDetail/>}/></Routes></MemoryRouter>);
  // Act / Assert: the role-specific action opens the same read-only report for the selected event.
  fireEvent.click(await screen.findByRole('button',{name:'Registration information'}));
  expect(await screen.findByRole('table')).toBeVisible();
  expect(api.get).toHaveBeenCalledWith('/events/7/lead-registrations','lead');
});
