import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import VenueBookingRequest from '../../frontend/src/pages/events/VenueBookingRequest';
import SessionVenueActions from '../../frontend/src/pages/events/SessionVenueActions';
import VenueBookingDecisions from '../../frontend/src/pages/events/VenueBookingDecisions';
import VenueBookingInbox from '../../frontend/src/pages/venue/VenueBookingInbox';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn(),put:vi.fn()}}));
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'token'})}));
const event={id:3,proposed_date:'2030-11-01',proposed_start_time:'10:00',proposed_end_time:'11:00',expected_attendance:20};
const booking={id:20,event_id:3,venue_id:7,start_datetime:'2030-11-01T02:00:00Z',end_datetime:'2030-11-01T03:00:00Z',
  requirements:{sessionName:'Track A',capacity:20,layout:'Seminar',accessibility:[],requiredFacilities:[]}};
beforeEach(()=>{vi.resetAllMocks();api.get.mockResolvedValue([{id:7,name:'North'}]);api.post.mockResolvedValue({request:{id:20}});api.put.mockResolvedValue({request:{...booking,status:'pending'}});});
afterEach(cleanup);
it('Session venues AC1 AC2 AC4 - named session submission records its own timing and prevents event-wide cancellation',async()=>{
  // Arrange: a session uses its own attendee count, with legacy bulk cancellation deliberately selected first.
  render(<VenueBookingRequest event={event} token="token"/>);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Session / track (optional)'),{target:{value:'Track A'}});
  fireEvent.change(screen.getByLabelText('Expected attendance / capacity'),{target:{value:'15'}});
  // Act / Assert: the snapshot identifies this session, and the unsafe cross-session checkbox is withdrawn.
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Request venue'}));
  await waitFor(()=>expect(api.post).toHaveBeenCalledWith('/venues/7/requests',expect.objectContaining({sessionName:'Track A',capacity:15,cancelOtherPending:false,startDatetime:'2030-11-01T10:00:00+08:00'}),'token'));
});
it('Session venues AC2 AC3 AC4 - changing a session preserves its identity and submits only its request ID',async()=>{
  // Arrange: an existing named session opens the same compact requirements form in revision mode.
  const saved=vi.fn();render(<SessionVenueActions booking={booking} token="token" onSaved={saved}/>);
  fireEvent.click(screen.getByRole('button',{name:'Change session request'}));
  expect(await screen.findByLabelText('Venue')).toBeDisabled();
  expect(screen.getByLabelText('Session / track (optional)')).toHaveValue('Track A');
  fireEvent.change(screen.getByLabelText('Expected attendance / capacity'),{target:{value:'30'}});
  // Act / Assert: only request 20 is revised; successful persistence closes the edit form.
  fireEvent.click(screen.getByRole('button',{name:'Request venue'}));
  await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/venues/7/requests/20/session',expect.objectContaining({capacity:30,sessionName:'Track A'}),'token'));
  await waitFor(()=>expect(saved).toHaveBeenCalledWith(expect.objectContaining({id:20})));
  expect(screen.queryByRole('button',{name:'Request venue'})).not.toBeInTheDocument();
});
it('Session venues AC4 - cancelling one session sends no event-wide action',async()=>{
  // Arrange / Act: cancellation is explicit and scoped to the selected booking.
  const saved=vi.fn();render(<SessionVenueActions booking={booking} token="token" onSaved={saved}/>);
  fireEvent.click(screen.getByRole('button',{name:'Cancel session request'}));
  // Assert: other session IDs cannot appear in the request; the response drives the visible status update.
  await waitFor(()=>expect(saved).toHaveBeenCalled());
  expect(api.put).toHaveBeenCalledWith('/venues/7/requests/20/session',{cancel:true},'token');
});
it('Session venues AC4 - failed cancellation keeps the session editable and shows the server error',async()=>{
  // Arrange: the server may reject a stale or reassigned event.
  api.put.mockRejectedValue(new Error('Assignment changed'));const saved=vi.fn();
  render(<SessionVenueActions booking={booking} token="token" onSaved={saved}/>);
  // Act / Assert: failure cannot fabricate cancellation or lose the user's current arrangement.
  fireEvent.click(screen.getByRole('button',{name:'Cancel session request'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Assignment changed');expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Change session request'}));
  fireEvent.click(screen.getByRole('button',{name:'Keep current request'}));
  expect(screen.queryByRole('button',{name:'Request venue'})).not.toBeInTheDocument();
});
it('Session venues AC1 AC4 - cancelling a displayed session preserves the other visible arrangement',async()=>{
  // Arrange: both sessions appear in the real booking-history component.
  api.get.mockResolvedValue({bookings:[{...booking,status:'pending',venue_name:'North'},
    {...booking,id:21,status:'pending',venue_name:'South',requirements:{...booking.requirements,sessionName:'Track B'}}]});
  api.put.mockResolvedValue({request:{...booking,status:'cancelled'}});
  render(<VenueBookingDecisions eventId={3}/>);
  const manage=await screen.findByRole('region',{name:'Manage Track A'});
  // Act / Assert: parent state applies the selected response while the other session keeps its own actions.
  const {within}=await import('@testing-library/react');
  fireEvent.click(within(manage).getByRole('button',{name:'Cancel session request'}));
  expect(await screen.findByRole('listitem',{name:'North Cancelled'})).toBeVisible();
  expect(screen.getByRole('region',{name:'Manage Track B'})).toBeVisible();
});
it('Session venues AC2 AC3 - staff review identifies the session and its own requirements',async()=>{
  // Arrange: the same event may have several requests; its session label must be visible before and during review.
  api.get.mockResolvedValue({requests:[{...booking,status:'pending',event_name:'Workshop',venue_name:'North',expected_attendance:20}]});
  render(<VenueBookingInbox/>);
  expect(await screen.findByText('Session: Track A')).toBeVisible();
  // Act / Assert: opening review retains the session identity rather than substituting event-wide attendance.
  fireEvent.click(screen.getByRole('button',{name:'Review Workshop at North'}));
  expect(screen.getAllByText('Session: Track A')).toHaveLength(2);
  expect(screen.getByRole('dialog')).toHaveTextContent('20');
});
it('Session venues AC3 AC4 - an expired named session requires a new request instead of editing its approval',async()=>{
  // Arrange: a named session remains in history after expiration but no longer has a live arrangement to revise.
  api.get.mockResolvedValue({bookings:[{...booking,status:'expired',venue_name:'North'}]});
  render(<VenueBookingDecisions eventId={3}/>);
  // Act / Assert: show recovery guidance while withholding change/cancel actions for the expired session.
  expect(await screen.findByRole('listitem',{name:'North Expired'})).toBeVisible();
  expect(screen.getByText(/new venue request for fresh availability/)).toBeVisible();
  expect(screen.queryByRole('region',{name:'Manage Track A'})).not.toBeInTheDocument();
});
