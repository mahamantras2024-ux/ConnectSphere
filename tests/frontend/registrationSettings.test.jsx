import '@testing-library/jest-dom/vitest';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import RegistrationSettings from '../../frontend/src/pages/events/RegistrationSettings';
import AttendeeRegistration from '../../frontend/src/pages/registrations/AttendeeRegistration';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),put:vi.fn(),post:vi.fn()}}));
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'token'})}));
const event={id:7,status:'draft',is_draft:true,registration_open:false,registration_deadline:null,withdrawal_deadline:null};
beforeEach(()=>vi.resetAllMocks());afterEach(cleanup);
it('Registration settings AC1 AC3 - draft editor saves separate Singapore deadlines as explicit instants',async()=>{
  // Arrange: no deadline is silently copied into the other input.
  const saved=vi.fn();api.put.mockResolvedValue({event,message:'Registration deadlines saved.'});
  render(<RegistrationSettings event={event} token="token" onSaved={saved}/>);
  expect(screen.getByLabelText('Withdrawal deadline (Singapore time)')).toHaveValue('');
  // Act / Assert: the two independent controls retain their own time and explicit +08:00 conversion.
  fireEvent.change(screen.getByLabelText('Registration deadline (Singapore time)'),{target:{value:'2030-11-01T17:00'}});
  fireEvent.change(screen.getByLabelText('Withdrawal deadline (Singapore time)'),{target:{value:'2030-11-01T16:30'}});
  fireEvent.click(screen.getByRole('button',{name:'Save deadlines'}));
  await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/events/7/registration-settings',{
    registrationDeadline:'2030-11-01T09:00:00.000Z',withdrawalDeadline:'2030-11-01T08:30:00.000Z'},'token'));
  expect(await screen.findByRole('status')).toHaveTextContent('saved');expect(saved).toHaveBeenCalledWith(event);
});
it('Registration settings AC2 - submitted editor requests review and keeps accepted deadlines unchanged',async()=>{
  // Arrange: the accepted registration deadline is 16:00 Singapore; the organiser proposes 17:00.
  const saved=vi.fn();api.put.mockResolvedValue({changeRequest:{id:10},message:'Awaiting Coordinator approval.'});
  render(<RegistrationSettings event={{...event,is_draft:false,status:'submitted',registration_deadline:'2030-11-01T08:00:00Z'}} token="token" onSaved={saved}/>);
  expect(screen.getByLabelText('Registration deadline (Singapore time)')).toHaveValue('2030-11-01T16:00');
  const accepted=screen.getByText('Accepted registration deadline').parentElement.textContent;
  // Act / Assert: pending proposals must not replace accepted event fields in the parent view.
  fireEvent.change(screen.getByLabelText('Registration deadline (Singapore time)'),{target:{value:'2030-11-01T17:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Request deadline change'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Coordinator approval');expect(saved).not.toHaveBeenCalled();
  expect(screen.getByText('Accepted registration deadline').parentElement).toHaveTextContent(accepted);
});
it('Registration settings AC3 - invalid save error retains inputs and does not manufacture accepted values',async()=>{
  // Arrange: the authoritative server rejects a deadline after the event start.
  const saved=vi.fn();api.put.mockRejectedValue(new Error('Deadline must be on or before event start.'));
  render(<RegistrationSettings event={event} token="token" onSaved={saved}/>);
  fireEvent.change(screen.getByLabelText('Registration deadline (Singapore time)'),{target:{value:'2030-11-01T19:00'}});
  // Act / Assert: explain the error and retain the proposal for correction.
  fireEvent.click(screen.getByRole('button',{name:'Save deadlines'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('event start');
  expect(screen.getByLabelText('Registration deadline (Singapore time)')).toHaveValue('2030-11-01T19:00');expect(saved).not.toHaveBeenCalled();
});
it('Registration settings AC7 - blank controls explicitly restore both event-start fallbacks',async()=>{
  // Arrange / Act: both deadlines are optional and an empty input is an intentional null, not a device-local timestamp.
  api.put.mockResolvedValue({event,message:'Saved'});
  render(<RegistrationSettings event={event} token="token" onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Save deadlines'}));
  // Assert: neither field inherits a hidden default from the other.
  await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/events/7/registration-settings',{registrationDeadline:null,withdrawalDeadline:null},'token'));
});
it('Registration settings AC8 AC9 - manual opening and closing use separate explicit controls',async()=>{
  // Arrange: only a Confirmed event can open; accepted deadline edits are a different action.
  const saved=vi.fn();api.put.mockImplementation(async(path,body)=>({event:{...event,registration_open:body.open},message:body.open?'Opened':'Closed'}));
  const view=render(<RegistrationSettings event={{...event,is_draft:false,status:'confirmed'}} token="token" onSaved={saved}/>);
  // Act / Assert: explicit opening then closing never sends pending deadline fields with the toggle.
  fireEvent.click(screen.getByRole('button',{name:'Open registration'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Opened');
  expect(api.put).toHaveBeenLastCalledWith('/events/7/registration-availability',{open:true},'token');
  view.rerender(<RegistrationSettings event={{...event,is_draft:false,status:'confirmed',registration_open:true}} token="token" onSaved={saved}/>);
  fireEvent.click(screen.getByRole('button',{name:'Close registration'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Closed');
  expect(api.put).toHaveBeenLastCalledWith('/events/7/registration-availability',{open:false},'token');
});
it('Registration settings AC8 - early approval cannot offer manual opening and a failed open stays closed',async()=>{
  // Arrange / Act / Assert: initial approval is insufficient for opening, matching the final lifecycle gate.
  const view=render(<RegistrationSettings event={{...event,status:'approved',is_draft:false}} token="token" onSaved={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Open registration'})).toBeDisabled();
  api.put.mockRejectedValue(new Error('Registration deadline passed'));
  view.rerender(<RegistrationSettings event={{...event,status:'confirmed',is_draft:false}} token="token" onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Open registration'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('deadline passed');
  expect(screen.getByRole('button',{name:'Open registration'})).toBeEnabled();
});
it('Registration settings AC6 - attendees see both deadlines with an explicit Singapore time zone',async()=>{
  // Arrange: withdrawal and registration have different accepted deadlines.
  api.get.mockResolvedValue({registration:null,deadline:'2030-11-01T09:00:00Z',withdrawalDeadline:'2030-11-01T08:00:00Z',remaining:1,blocker:null});
  render(<MemoryRouter><AttendeeRegistration eventId={7}/></MemoryRouter>);
  // Act / Assert: both public deadline labels are present and independently timezone-labelled.
  expect(await screen.findByText(/Registration deadline:.*Singapore time/)).toBeVisible();
  expect(screen.getByText(/Withdrawal deadline:.*Singapore time/)).toBeVisible();
});
for(const remaining of [0,1])it(`Registration settings AC4 AC9 - closed registration hides new entry actions with ${remaining} places`,async()=>{
  // Arrange: closing must block both a free-seat registration and joining a full event's waitlist.
  api.get.mockResolvedValue({registration:null,remaining,blocker:'Registration closed by the Event Organiser.'});
  render(<MemoryRouter><AttendeeRegistration eventId={7}/></MemoryRouter>);
  // Act / Assert: the closed state explains the block instead of presenting an action that cannot succeed.
  expect(await screen.findByText('Registration closed by the Event Organiser.')).toBeVisible();
  expect(screen.queryByRole('button',{name:'Register for event'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Join waitlist'})).not.toBeInTheDocument();
});
