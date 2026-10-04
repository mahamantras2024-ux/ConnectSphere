// File: Verifies staff venue editing, booking acknowledgements, safe removal, live catalogue refresh and keyless map selection.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import AddVenueModal from '../../frontend/src/pages/venues/AddVenueModal';
import VenueDetail from '../../frontend/src/pages/venues/VenueDetail';
import VenueList from '../../frontend/src/pages/venues/VenueList';
import LocationPicker from '../../frontend/src/pages/venues/LocationPicker';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({user:{role:'venue_staff'},token:'staff-token'})})); // Supplies a provisioned staff session.
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}})); // Controls API outcomes without altering real records.
vi.mock('../../frontend/src/pages/venues/VenueMap',()=>({default:({onPick})=><div role="region" aria-label="Venue location map">{onPick && <button type="button" onClick={()=>onPick({latitude:1.296,longitude:103.85})}>Pick location</button>}</div>})); // Keeps UI tests independent of tile downloads; the actual map is checked in the browser.
const venue={id:7,name:'Garden Hall',location:'Stamford Road',capacity:100,supported_layouts:['Theatre','Banquet'],facilities:['Wi-Fi','Projector'],accessibility_features:['Ramp'],operating_hours:'08:00 - 22:00',availability_status:'Available',setup_minutes:30,turnaround_minutes:45,pricing:'S$500',mrt:'Bras Basah MRT',mrt_distance_m:100,latitude:1.296,longitude:103.85,revision:3};
const booking={booking_id:9,event_id:2,event_name:'Annual gathering',status:'approved',start_datetime:'2030-10-10T00:00:00Z',end_datetime:'2030-10-10T04:00:00Z',reasons:['80 guests exceed the new capacity of 50.']};
beforeEach(()=>{vi.clearAllMocks();api.get.mockResolvedValue([venue]);}); // Starts each case with a single active venue.
afterEach(()=>{cleanup();vi.unstubAllGlobals();}); // Releases mounted dialogs and synthetic browser globals.
it('prefills editable venue fields and saves its revision, availability and map coordinates',async()=> {
 const saved=vi.fn(),close=vi.fn();api.put.mockResolvedValue({venue:{...venue,name:'Updated hall',revision:4}});
 render(<AddVenueModal venue={venue} onClose={close} onAdd={saved}/>);
 expect(screen.getByLabelText('Opening time *').value).toBe('08:00');expect(screen.getByLabelText('Setup time (minutes) *').value).toBe('30');expect(screen.getByPlaceholderText('Hourly rate (e.g. 500)').value).toBe('500');
 fireEvent.change(screen.getByLabelText('Venue name *'),{target:{value:'Updated hall'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 await waitFor(()=>expect(saved).toHaveBeenCalled());expect(close).toHaveBeenCalledOnce();
 expect(api.put).toHaveBeenCalledWith('/venues/7',expect.objectContaining({name:'Updated hall',pricing:'500',revision:3,latitude:1.296,longitude:103.85,turnaroundMinutes:45,availabilityStatus:'Available'}),'staff-token');
 expect(screen.queryByRole('textbox',{name:/nearest mrt/i})).toBeNull();
});
it('shows affected bookings and keeps the record unsaved until staff explicitly confirm',async()=> {
 const saved=vi.fn();api.put.mockRejectedValueOnce(Object.assign(new Error('Review bookings'),{details:{code:'BOOKING_IMPACT',affectedBookings:[booking],confirmationToken:'specific-change-token'}})).mockResolvedValueOnce({venue:{...venue,capacity:50}});
 render(<AddVenueModal venue={venue} onClose={()=>{}} onAdd={saved}/>);
 fireEvent.change(screen.getByLabelText('Capacity *'),{target:{value:'50'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(await screen.findByText('Annual gathering')).toBeTruthy();expect(saved).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm changes & save'}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
 expect(api.put).toHaveBeenLastCalledWith('/venues/7',expect.objectContaining({capacity:50,confirmationToken:'specific-change-token'}),'staff-token');
});
it('changing a field after a warning invalidates the displayed acknowledgement',async()=> {
 api.put.mockRejectedValue(Object.assign(new Error('Review bookings'),{details:{code:'BOOKING_IMPACT',affectedBookings:[booking],confirmationToken:'token'}}));
 render(<AddVenueModal venue={venue} onClose={()=>{}}/>);fireEvent.change(screen.getByLabelText('Capacity *'),{target:{value:'50'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 await screen.findByText('Annual gathering');fireEvent.change(screen.getByLabelText('Capacity *'),{target:{value:'60'}});
 expect(screen.queryByRole('button',{name:'Confirm changes & save'})).toBeNull();expect(screen.getByRole('button',{name:'Save changes'}).disabled).toBe(false);
});
it('blocked deactivation lists bookings and preserves the open record',async()=> {
 const removed=vi.fn(),close=vi.fn();api.delete.mockRejectedValue(Object.assign(new Error('Upcoming bookings prevent deactivation.'),{details:{affectedBookings:[booking]}}));
 render(<VenueDetail venue={venue} canManage token="staff-token" onClose={close} onRemoved={removed}/>);
 fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));expect(api.delete).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm deactivation'}));expect(await screen.findByText('Annual gathering')).toBeTruthy();
 expect(removed).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(screen.getByRole('dialog').classList.contains('venue-drawer')).toBe(true);
});
it('successful deactivation removes the catalogue card and closes the drawer',async()=> {
 api.delete.mockResolvedValue({message:'Deactivated'});api.get.mockResolvedValueOnce([venue]).mockResolvedValue([]);
 render(<VenueList/>);fireEvent.click(await screen.findByRole('button',{name:/view details/i}));fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));fireEvent.click(screen.getByRole('button',{name:'Confirm deactivation'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.queryByRole('heading',{name:'Garden Hall'})).toBeNull();expect(screen.getByRole('status').textContent).toMatch(/deactivated/i);
});
it('database invalidation refreshes another staff catalogue and its open detail drawer',async()=> {
 let stream;class TestStream {constructor(){stream=this;}close(){}}vi.stubGlobal('EventSource',TestStream); // Captures the SSE callback to simulate another staff member saving.
 render(<VenueList/>);fireEvent.click(await screen.findByRole('button',{name:/view details/i}));
 api.get.mockResolvedValue([{...venue,capacity:200}]);act(()=>stream.onmessage({data:'changed'}));
 await waitFor(()=>expect(screen.getAllByText('200 Guests').length).toBe(2));
});
it('read-only profiles do not expose venue management controls',()=> {
 render(<VenueDetail venue={venue} onClose={()=>{}}/>);expect(screen.queryByRole('button',{name:'Edit venue'})).toBeNull();expect(screen.queryByRole('button',{name:'Deactivate venue'})).toBeNull();
});
it('address search requires an action and result selection calculates MRT without an editable field',async()=> {
 const changed=vi.fn();api.get.mockImplementation(async path=>path.includes('/search?')?[{location:'SMU, Singapore',latitude:1.296,longitude:103.85}]:{location:'SMU, Singapore',latitude:1.296,longitude:103.85,mrt:{name:'Bras Basah MRT',distanceM:100}});
 // Shows the latest controlled selection exactly as the real venue form does.
 function Form(){const [value,setValue]=useState({location:''});return <LocationPicker value={value} onChange={next=>{setValue(next);changed(next);}}/>;}
 render(<Form/>);fireEvent.change(screen.getByPlaceholderText('Location / Address *'),{target:{value:'SMU'}});expect(api.get).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.click(await screen.findByRole('button',{name:'SMU, Singapore'}));
 expect(await screen.findByText('Bras Basah MRT')).toBeTruthy();expect(changed).toHaveBeenCalledWith(expect.objectContaining({latitude:1.296,mrt:{name:'Bras Basah MRT',distanceM:100}}));expect(screen.queryByRole('textbox',{name:/mrt/i})).toBeNull();
});
