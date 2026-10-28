// SCRUM-106 UI scope: user interactions are real; only the remote API is replaced.
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,it,expect,vi} from 'vitest';
import VenueClosureForm from '../../frontend/src/pages/venues/VenueClosureForm';
import VenueDisruptions from '../../frontend/src/pages/events/VenueDisruptions';
import {MemoryRouter} from 'react-router-dom';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
it('SCRUM-106 AC1 AC2 - staff save a reasoned closure and see affected bookings without event cancellation',async()=>{
 // Arrange: server identifies the affected Gala booking; the component must display this actual response.
 api.post.mockResolvedValue({affectedBookings:[{id:5,event_name:'Gala'}]});
 render(<VenueClosureForm venueId={7} token="staff"/>);
 fireEvent.change(screen.getByLabelText('Closure starts'),{target:{value:'2031-10-20T09:30'}});
 fireEvent.change(screen.getByLabelText('Closure ends'),{target:{value:'2031-10-20T12:30'}});
 fireEvent.change(screen.getByLabelText('Closure reason'),{target:{value:'Emergency repairs'}});
 // Act / Assert: a missing timezone conversion or lost reason would fail this exact API assertion.
 fireEvent.click(screen.getByRole('button',{name:'Record venue closure'}));
 await screen.findByText('Gala');
 expect(api.post).toHaveBeenCalledWith('/venues/7/closures',{startDatetime:'2031-10-20T01:30:00.000Z',endDatetime:'2031-10-20T04:30:00.000Z',reason:'Emergency repairs'},'staff');
 expect(screen.getByText(/Events are not automatically cancelled/)).toBeInTheDocument();
});
it('SCRUM-106 AC1 - closure save failure is shown without reporting success',async()=>{
 api.post.mockRejectedValue(new Error('Unable to record closure'));
 render(<VenueClosureForm venueId={7} token="staff"/>);
 fireEvent.change(screen.getByLabelText('Closure starts'),{target:{value:'2031-10-20T09:30'}});
 fireEvent.change(screen.getByLabelText('Closure ends'),{target:{value:'2031-10-20T12:30'}});
 fireEvent.change(screen.getByLabelText('Closure reason'),{target:{value:'Repairs'}});
 fireEvent.click(screen.getByRole('button',{name:'Record venue closure'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Unable to record closure');
 expect(screen.queryByText('Closure recorded.')).not.toBeInTheDocument();
});
it('SCRUM-106 AC4 AC5 - cancel affects one booking and explains the fresh review requirement',async()=>{
 api.get.mockImplementation(path=>Promise.resolve(path.endsWith('venue-disruptions')?{issues:[{id:2,booking_id:5,venue_name:'Hall A',reason:'Repairs'}]}:{bookings:[]}));
 api.post.mockResolvedValue({resolution:'cancelled'});
 const refreshed=vi.fn(); render(<MemoryRouter><VenueDisruptions eventId={3} token="coordinator" onResolved={refreshed}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Cancel affected booking at Hall A'}));
 await waitFor(()=>expect(refreshed).toHaveBeenCalledTimes(1));
 expect(api.post).toHaveBeenCalledWith('/events/3/venue-disruptions/2/resolve',{replacementBookingId:null},'coordinator');
 expect(screen.getByText(/fresh safety review/i)).toBeInTheDocument();
});
it('SCRUM-106 AC4 - replacement submits the selected approved booking and reports stale conflicts',async()=>{
 api.get.mockImplementation(path=>Promise.resolve(path.endsWith('venue-disruptions')?{issues:[{id:2,booking_id:5,venue_name:'Hall A',reason:'Repairs'}]}:{bookings:[{id:8,venue_name:'Hall B',status:'approved'}]}));
 api.post.mockRejectedValue(new Error('Replacement no longer valid'));
 render(<MemoryRouter><VenueDisruptions eventId={3} token="coordinator" onResolved={()=>{}}/></MemoryRouter>);
 fireEvent.change(await screen.findByLabelText('Replacement for Hall A'),{target:{value:'8'}});
 fireEvent.click(screen.getByRole('button',{name:'Use replacement for Hall A'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Replacement no longer valid');
 expect(api.post).toHaveBeenCalledWith('/events/3/venue-disruptions/2/resolve',{replacementBookingId:8},'coordinator');
});
it('SCRUM-106 AC4 - failed issue loading is visible and cannot offer a recovery action',async()=>{
 api.get.mockRejectedValue(new Error('Event not found'));
 render(<MemoryRouter><VenueDisruptions eventId={3} token="old-coordinator" onResolved={()=>{}}/></MemoryRouter>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Event not found');
 expect(screen.queryByRole('button',{name:/Cancel affected/})).not.toBeInTheDocument();
});
it('SCRUM-106 AC4 - approved replacement resolves the issue and refreshes event state',async()=>{
 api.get.mockImplementation(path=>Promise.resolve(path.endsWith('venue-disruptions')?{issues:[{id:2,booking_id:5,venue_name:'Hall A',reason:'Repairs',start_datetime:'2031-10-20T01:00:00Z',end_datetime:'2031-10-20T02:00:00Z'}]}:{bookings:[{id:8,venue_name:'Hall B',status:'approved'}]}));
 api.post.mockResolvedValue({resolution:'replaced'});const refreshed=vi.fn();
 render(<MemoryRouter><VenueDisruptions eventId={3} token="coordinator" onResolved={refreshed}/></MemoryRouter>);
 fireEvent.change(await screen.findByLabelText('Replacement for Hall A'),{target:{value:'8'}});
 fireEvent.click(screen.getByRole('button',{name:'Use replacement for Hall A'}));
 await waitFor(()=>expect(refreshed).toHaveBeenCalledTimes(1));
 expect(screen.queryByRole('button',{name:'Cancel affected booking at Hall A'})).not.toBeInTheDocument();
});
it('SCRUM-106 AC4 - only approved unaffected bookings can be selected as replacements',async()=>{
 api.get.mockImplementation(path=>Promise.resolve(path.endsWith('venue-disruptions')?{issues:[{id:2,booking_id:5,venue_name:'Hall A',reason:'Repairs'}]}:{bookings:[{id:5,venue_name:'Hall A',status:'approved'},{id:8,venue_name:'Hall B',status:'pending'},{id:9,venue_name:'Hall C',status:'approved'}]}));
 render(<MemoryRouter><VenueDisruptions eventId={3} token="coordinator" onResolved={()=>{}}/></MemoryRouter>);
 await screen.findByRole('option',{name:'Hall C (booking 9)'});
 expect(screen.queryByRole('option',{name:/Hall A|Hall B/})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Use replacement for Hall A'})).toBeDisabled();
});
