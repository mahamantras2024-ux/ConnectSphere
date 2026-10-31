// SCRUM-107: test staff controls and coordinator confirmation through real components, mocking only network/session boundaries.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VenueBookingInbox from '../../frontend/src/pages/venue/VenueBookingInbox';
import VenueBookingDecisions from '../../frontend/src/pages/events/VenueBookingDecisions';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'hold-test-token'})}));
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),put:vi.fn()}}));
const hold={id:20,venue_id:7,event_id:3,event_name:'Workshop',venue_name:'Garden Hall',status:'tentative',
  start_datetime:'2030-10-10T10:00:00Z',end_datetime:'2030-10-10T11:00:00Z',hold_expires_at:'2030-10-09T11:00:00Z'};
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2030-10-09T10:00:00Z'));
  api.get.mockResolvedValue({requests:[{...hold,status:'pending'}],bookings:[hold]});
  api.put.mockResolvedValue({request:{...hold,decision_by:9,updated_at:'2030-10-09T10:00:00Z'}});
});
afterEach(()=>{cleanup();vi.useRealTimers();});

it('SCRUM-107 AC1 - staff cannot approve without a specific future expiry',async()=>{
  // Arrange: pending review has no implicitly selected 24-hour staff approval deadline.
  render(<VenueBookingInbox/>);
  fireEvent.click(await screen.findByRole('button',{name:'Review Workshop at Garden Hall'}));
  // Act / Assert: missing or past values cannot reach the API.
  fireEvent.click(screen.getByRole('button',{name:'Approve request'}));
  expect(screen.getByRole('alert')).toHaveTextContent(/future hold expiry/i);expect(api.put).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Hold expiry (Singapore time)'),{target:{value:'2030-10-09T17:59'}});
  fireEvent.click(screen.getByRole('button',{name:'Approve request'}));expect(api.put).not.toHaveBeenCalled();
});

it('SCRUM-107 AC1 - staff approval sends Singapore-local input as an explicit UTC instant',async()=>{
  // Arrange: 19:00 Singapore is 11:00 UTC, independently of the computer's local time zone.
  render(<VenueBookingInbox/>);fireEvent.click(await screen.findByRole('button',{name:'Review Workshop at Garden Hall'}));
  fireEvent.change(screen.getByLabelText('Hold expiry (Singapore time)'),{target:{value:'2030-10-09T19:00'}});
  // Act / Assert: no implicit duration or timezone conversion based on the user's device is allowed.
  fireEvent.click(screen.getByRole('button',{name:'Approve request'}));
  await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/venues/7/requests/20/decision',
    {decision:'approved',reason:'',holdExpiresAt:'2030-10-09T11:00:00.000Z'},'hold-test-token'));
  expect(await screen.findByRole('status')).toHaveTextContent(/Tentative hold/);
});

it('SCRUM-107 AC2 - staff can replace a live hold deadline without another approval',async()=>{
  // Arrange: a tentatively approved request stays available for expiry management.
  api.get.mockResolvedValue({requests:[hold]});render(<VenueBookingInbox/>);
  fireEvent.click(await screen.findByRole('button',{name:'Review Workshop at Garden Hall'}));
  expect(screen.getByLabelText('Hold expiry (Singapore time)')).toHaveValue('2030-10-09T19:00');
  // Act / Assert: extending by one hour calls the expiry endpoint and preserves the request identity.
  fireEvent.change(screen.getByLabelText('Hold expiry (Singapore time)'),{target:{value:'2030-10-09T20:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Save expiry'}));
  await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/venues/7/requests/20/expiry',
    {holdExpiresAt:'2030-10-09T12:00:00.000Z'},'hold-test-token'));
});

it('SCRUM-107 AC3 AC5 - coordinator sees the deadline and explicitly confirms a live hold',async()=>{
  // Arrange: staff approval alone must be displayed as tentative rather than final.
  api.put.mockResolvedValue({request:{...hold,status:'approved'}});render(<VenueBookingDecisions eventId={3}/>);
  const row=await screen.findByRole('listitem',{name:'Garden Hall Tentative hold'});
  expect(within(row).getByText(/Expires.*SGT/)).toBeVisible();
  // Act / Assert: the trusted server response is the only source of final confirmation.
  fireEvent.click(within(row).getByRole('button',{name:'Confirm venue arrangement'}));
  await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/venues/7/requests/20/confirm',{},'hold-test-token'));
  expect(await screen.findByRole('listitem',{name:'Garden Hall Approved'})).toBeVisible();
});

for(const expiry of ['2030-10-09T09:59:59.999Z','2030-10-09T10:00:00Z']){
  it(`SCRUM-107 AC3 AC5 - coordinator cannot confirm a hold expiring at ${expiry}`,async()=>{
    // Arrange / Act: expiration is enforced at equality even before the backend cleanup tick arrives.
    api.get.mockResolvedValue({bookings:[{...hold,hold_expires_at:expiry}]});render(<VenueBookingDecisions eventId={3}/>);
    const row=await screen.findByRole('listitem',{name:'Garden Hall Expired'});
    // Assert: make the recovery requirement clear, without offering a misleading confirmation button.
    expect(within(row).getByText(/new venue request.*fresh availability.*approval/i)).toBeVisible();
    expect(within(row).queryByRole('button',{name:'Confirm venue arrangement'})).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
}

it('SCRUM-107 AC6 - a rejected late confirmation keeps the newer booking intact and shows recovery instructions',async()=>{
  // Arrange: the client still sees a live hold, but the authoritative server finds it expired/conflicted.
  api.put.mockRejectedValue(new Error('Hold expired. Submit a new venue request for fresh availability and approval.'));
  render(<VenueBookingDecisions eventId={3}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Confirm venue arrangement'}));
  // Assert: no fabricated success or removal follows the failed confirmation.
  expect(await screen.findByRole('alert')).toHaveTextContent(/Hold expired/);
  expect(screen.getByRole('listitem',{name:'Garden Hall Tentative hold'})).toBeVisible();
});

it('SCRUM-107 AC3 AC5 - a visible hold becomes expired at its deadline without a page reload',async()=>{
  // Arrange: the hold starts one millisecond before expiry, completing the UI before/at/after boundary cases.
  vi.useRealTimers();
  vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});
  vi.setSystemTime(new Date('2030-10-09T10:00:00Z'));
  api.get.mockResolvedValue({bookings:[{...hold,hold_expires_at:'2030-10-09T10:00:00.001Z'}]});
  render(<VenueBookingDecisions eventId={3}/>);
  expect(await screen.findByRole('button',{name:'Confirm venue arrangement'})).toBeEnabled();
  // Act / Assert: periodic time refresh withdraws the confirmation action as the deadline passes.
  act(()=>vi.advanceTimersByTime(1000));
  expect(screen.getByRole('listitem',{name:'Garden Hall Expired'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Confirm venue arrangement'})).not.toBeInTheDocument();
  expect(api.put).not.toHaveBeenCalled();
});

it('SCRUM-107 AC5 AC6 - confirmation prevents duplicate saves and explains an unlabelled server failure',async()=>{
  // Arrange: a slow confirmation must not submit twice, even if clicked repeatedly.
  let fail;api.put.mockReturnValue(new Promise((resolve,reject)=>{fail=reject;}));
  render(<VenueBookingDecisions eventId={3}/>);
  const button=await screen.findByRole('button',{name:'Confirm venue arrangement'});
  // Act / Assert: only one request is sent; a generic recovery message appears when no server message exists.
  fireEvent.click(button);fireEvent.click(button);
  expect(button).toBeDisabled();expect(api.put).toHaveBeenCalledTimes(1);
  await act(async()=>{fail({});});
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to confirm the venue arrangement.');
  expect(button).toBeEnabled();
});

it('SCRUM-107 AC2 - failed expiry update retains the typed deadline and leaves the saved hold unchanged',async()=>{
  // Arrange: expiry management uses the same error-preserving drawer as initial review.
  api.get.mockResolvedValue({requests:[hold]});api.put.mockRejectedValue(new Error('Hold has expired; request fresh approval.'));
  render(<VenueBookingInbox/>);fireEvent.click(await screen.findByRole('button',{name:'Review Workshop at Garden Hall'}));
  fireEvent.change(screen.getByLabelText('Hold expiry (Singapore time)'),{target:{value:'2030-10-09T20:00'}});
  // Act / Assert: a rejected extension cannot turn into a success notice or silently change the recorded deadline.
  fireEvent.click(screen.getByRole('button',{name:'Save expiry'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/fresh approval/);
  expect(screen.getByLabelText('Hold expiry (Singapore time)')).toHaveValue('2030-10-09T20:00');
  expect(screen.queryByText(/Tentative hold updated:/)).not.toBeInTheDocument();
});

it('SCRUM-107 AC2 - expiry replacement updates only the selected hold in a multi-venue queue',async()=>{
  // Arrange: two venues are held; changing one deadline must not rewrite the other reservation.
  api.get.mockResolvedValue({requests:[hold,{...hold,id:21,venue_id:8,venue_name:'Other Hall'}]});
  api.put.mockResolvedValue({request:{...hold,hold_expires_at:'2030-10-09T12:00:00Z'}});
  render(<VenueBookingInbox/>);fireEvent.click(await screen.findByRole('button',{name:'Review Workshop at Garden Hall'}));
  // Act / Assert: selected deadline changes; the other row retains its independent expiry and identity.
  fireEvent.change(screen.getByLabelText('Hold expiry (Singapore time)'),{target:{value:'2030-10-09T20:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Save expiry'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Tentative hold updated');
  fireEvent.click(screen.getByRole('button',{name:'Review Workshop at Other Hall'}));
  expect(screen.getByLabelText('Hold expiry (Singapore time)')).toHaveValue('2030-10-09T19:00');
});

it('SCRUM-107 AC3 AC6 - confirming one venue preserves the other tentative arrangement',async()=>{
  // Arrange: final confirmation belongs to one booking ID, not every venue associated with the event.
  api.get.mockResolvedValue({bookings:[hold,{...hold,id:21,venue_id:8,venue_name:'Other Hall'}]});
  api.put.mockResolvedValue({request:{...hold,status:'approved'}});
  render(<VenueBookingDecisions eventId={3}/>);
  const selected=await screen.findByRole('listitem',{name:'Garden Hall Tentative hold'});
  // Act / Assert: the chosen booking becomes final while the other hold remains tentative and confirmable.
  fireEvent.click(within(selected).getByRole('button',{name:'Confirm venue arrangement'}));
  expect(await screen.findByRole('listitem',{name:'Garden Hall Approved'})).toBeVisible();
  expect(within(screen.getByRole('listitem',{name:'Other Hall Tentative hold'})).getByRole('button',{name:'Confirm venue arrangement'})).toBeEnabled();
});
