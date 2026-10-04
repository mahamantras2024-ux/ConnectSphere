// File: Tests venue drawer actions, map failures, refresh cleanup, image errors and editing interactions.
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useState} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {api} from '../../frontend/src/api/client';
import VenueList from '../../frontend/src/pages/venues/VenueList';
import VenueDetail from '../../frontend/src/pages/venues/VenueDetail';
import AddVenueModal from '../../frontend/src/pages/venues/AddVenueModal';
import LocationPicker from '../../frontend/src/pages/venues/LocationPicker';
import BookingImpactList from '../../frontend/src/pages/venues/BookingImpactList';
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'staff',user:{role:'venue_staff'}})}));
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}}));
vi.mock('../../frontend/src/pages/venues/VenueMap',()=>({default:({onPick})=><button type="button" onClick={()=>onPick?.({latitude:1.3,longitude:103.85})}>Map point</button>}));
const venue={id:7,name:'Test hall',location:'Existing address',capacity:100,facilities:['Wi-Fi'],supported_layouts:['Theatre'],accessibility_features:['Ramp'],operating_hours:'08:00 - 22:00',availability_status:'Available',revision:0};
beforeEach(()=>{vi.clearAllMocks();api.get.mockResolvedValue([venue]);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('handles object catalogues, missing details and late responses without fictional values',async()=>{
 api.get.mockResolvedValue({venues:[{id:7,name:'Sparse venue'}]});render(<VenueList/>);
 await screen.findByText('Sparse venue');expect(screen.getByText('Location not specified')).toBeTruthy();expect(screen.getByText('Hours not specified')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/View details/}));expect(screen.getAllByText('Not specified').length).toBeGreaterThan(4);
 fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));expect(screen.queryByRole('dialog')).toBeNull();cleanup();
 api.get.mockResolvedValue({});render(<VenueList/>);await screen.findByText('No venues found. Add a venue to start your catalogue.');cleanup();
 let resolve,reject;api.get.mockImplementation(()=>new Promise((done,bad)=>{resolve=done;reject=bad;}));const view=render(<VenueList/>);view.unmount();await act(async()=>resolve([]));
 const failed=render(<VenueList/>);failed.unmount();await act(async()=>reject(new Error('Late')));
});
it('focus and fallback polling refresh the catalogue and close a removed open record',async()=>{
 render(<VenueList/>);fireEvent.click(await screen.findByRole('button',{name:/View details/}));api.get.mockResolvedValue([]);
 fireEvent(window,new Event('focus'));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());cleanup();
 vi.useFakeTimers();render(<VenueList/>);await act(async()=>{});const count=api.get.mock.calls.length;
 await act(async()=>vi.advanceTimersByTime(20000));expect(api.get.mock.calls.length).toBe(count+1);
});
it('editing from the drawer saves and returns to the updated profile',async()=>{
 api.put.mockResolvedValue({venue:{...venue,name:'Updated hall',revision:1}});api.get.mockResolvedValueOnce([venue]).mockResolvedValue([{...venue,name:'Updated hall',revision:1}]);
 render(<VenueList/>);fireEvent.click(await screen.findByRole('button',{name:/View details/}));fireEvent.click(screen.getByRole('button',{name:'Edit venue'}));
 fireEvent.change(screen.getByLabelText('Venue name *'),{target:{value:'Updated hall'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(await screen.findByText('Venue updated and shared with the catalogue.')).toBeTruthy();expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Venue Details');
});
it('cancelled deactivation never reaches the API and failures without booking metadata still show errors',async()=>{
 api.delete.mockRejectedValue(new Error('Unable to deactivate'));render(<VenueDetail venue={venue} canManage onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));fireEvent.click(screen.getByRole('button',{name:'Keep venue'}));expect(api.delete).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));fireEvent.click(screen.getByRole('button',{name:'Confirm deactivation'}));expect((await screen.findByRole('alert')).textContent).toBe('Unable to deactivate');
});
it('a pending deactivation cannot close the drawer or submit twice',async()=>{
 let finish;api.delete.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const close=vi.fn();render(<VenueDetail venue={venue} canManage onClose={close}/>);
 fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));fireEvent.click(screen.getByRole('button',{name:'Confirm deactivation'}));
 fireEvent.keyDown(document,{key:'Escape'});fireEvent.click(screen.getByRole('button',{name:'Checking bookings…'}));expect(close).not.toHaveBeenCalled();expect(api.delete).toHaveBeenCalledOnce();
 await act(async()=>finish({}));expect(close).toHaveBeenCalledOnce();
});
it('missing records render nothing and legacy camel-case fields remain readable',()=>{
 const first=render(<VenueDetail venue={null} onClose={()=>{}}/>);expect(screen.queryByRole('dialog')).toBeNull();first.unmount();
 render(<VenueDetail venue={{name:'Legacy',address:'Legacy address',facilities:'Wi-Fi',accessibilityFeatures:'Ramp',supportedLayouts:'Theatre',operatingHours:'09:00 - 18:00',availabilityStatus:'Maintenance',setupMinutes:10,turnaroundMinutes:20,mrtInfo:'City Hall MRT',price:'25',image:'https://example.test/image.jpg'}} onClose={()=>{}}/>);
 for(const value of ['Legacy address','Ramp','Theatre','09:00 - 18:00','Maintenance','10 minutes','20 minutes','City Hall MRT','$25/hr'])expect(screen.getByText(value)).toBeTruthy();
});
it('missing venue durations are unavailable while explicitly saved zero durations remain zero',()=>{
 const view=render(<VenueDetail venue={venue} onClose={()=>{}}/>);for(const label of ['Setup time','Turnaround time'])expect(screen.getByText(label).parentElement.textContent).toMatch(/Not specified/);view.unmount();
 render(<VenueDetail venue={{...venue,setup_minutes:0,turnaround_minutes:0}} onClose={()=>{}}/>);expect(screen.getAllByText('0 minutes')).toHaveLength(2);
});
it('booking warnings render unknown names, missing times, statuses and reasons honestly',()=>{
 const view=render(<BookingImpactList/>);expect(screen.queryAllByRole('listitem')).toHaveLength(0);view.unmount();
 render(<BookingImpactList bookings={[{booking_id:2,event_id:5,status:'pending'}]}/>);expect(screen.getByText('Event 5')).toBeTruthy();expect(screen.getByText(/Time not specified/)).toBeTruthy();
});
it('short queries, empty search results and address-service failures stay visible',async()=>{
 render(<LocationPicker value={{}} onChange={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(screen.getByRole('alert').textContent).toMatch(/at least three/);expect(api.get).not.toHaveBeenCalled();
 fireEvent.change(screen.getByPlaceholderText('Location / Address *'),{target:{value:'Hall'}});api.get.mockResolvedValue([]);fireEvent.keyDown(screen.getByPlaceholderText('Location / Address *'),{key:'Enter'});expect((await screen.findByRole('alert')).textContent).toMatch(/No matching/);
 api.get.mockRejectedValue(new Error('Provider offline'));fireEvent.click(screen.getByRole('button',{name:'Search'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('Provider offline'));
});
it('map clicks calculate a selected location and failures preserve the previous selection',async()=>{
 const changed=vi.fn();api.get.mockResolvedValue({latitude:1.3,longitude:103.85,location:'Map address',mrt:{name:'City Hall MRT',distanceM:25}});
 function Form(){const [value,setValue]=useState({location:'Previous address'});return <LocationPicker value={value} onChange={next=>{changed(next);setValue(next);}}/>;}
 render(<Form/>);fireEvent.click(screen.getByRole('button',{name:'Map point'}));expect(await screen.findByText('City Hall MRT')).toBeTruthy();expect(changed.mock.lastCall[0].location).toBe('Map address');
 api.get.mockRejectedValue(new Error('Unable to resolve location'));fireEvent.click(screen.getByRole('button',{name:'Map point'}));expect((await screen.findByRole('alert')).textContent).toBe('Unable to resolve location');expect(changed).toHaveBeenCalledOnce();
});
it('late map and search responses cannot overwrite a newer selection or a closed form',async()=>{
 const pending=[];api.get.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));const changed=vi.fn(),view=render(<LocationPicker value={{location:'Previous'}} onChange={changed}/>);
 fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.click(screen.getByRole('button',{name:'Map point'}));
 await act(async()=>pending[0].resolve([]));expect(screen.queryByRole('alert')).toBeNull();
 view.unmount();await act(async()=>pending[1].resolve({location:'Late',mrt:{name:'Late'}}));expect(changed).not.toHaveBeenCalled();
 const failed=render(<LocationPicker value={{location:'Previous'}} onChange={changed}/>);fireEvent.click(screen.getByRole('button',{name:'Search'}));failed.unmount();await act(async()=>pending[2].reject(new Error('Late error')));
 const mapFail=render(<LocationPicker value={{location:'Previous'}} onChange={changed}/>);fireEvent.click(screen.getByRole('button',{name:'Map point'}));mapFail.unmount();await act(async()=>pending[3].reject(new Error('Late error')));
});
it('image read failures show a useful error and a second upload cancels the first reader',()=>{
 const readers=[];class Reader {constructor(){readers.push(this);}abort=vi.fn();readAsDataURL=vi.fn();}
 vi.stubGlobal('FileReader',Reader);const view=render(<AddVenueModal venue={venue} onClose={()=>{}}/>);const input=view.baseElement.querySelector('input[type="file"]');
 fireEvent.change(input,{target:{files:[]}});expect(readers).toHaveLength(0);
 fireEvent.change(input,{target:{files:[new File(['image'],'a.png',{type:'image/png'})]}});act(()=>readers[0].onerror());expect(screen.getByRole('alert').textContent).toMatch(/Unable to read/);
 fireEvent.change(input,{target:{files:[new File(['image'],'b.png',{type:'image/png'})]}});expect(readers[0].abort).toHaveBeenCalledOnce();readers[1].result='data:image/png;base64,YQ==';act(()=>readers[1].onload());expect(screen.getByAltText('Venue preview').src).toContain('data:image/png');
});
it('form controls save optional fields and warnings can be dismissed for further editing',async()=>{
 const save=vi.fn();api.put.mockRejectedValueOnce(Object.assign(new Error('Review'),{details:{code:'BOOKING_IMPACT',confirmationToken:'token',affectedBookings:[]}})).mockResolvedValueOnce(venue);
 render(<AddVenueModal venue={venue} onClose={()=>{}} onAdd={save}/>);
 fireEvent.change(screen.getByLabelText('Availability'),{target:{value:'Maintenance'}});fireEvent.change(screen.getByLabelText('Turnaround time (minutes) *'),{target:{value:'30'}});
 fireEvent.change(screen.getByLabelText('Closing time *'),{target:{value:'20:00'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));await screen.findByText('These confirmed bookings may be affected');
 fireEvent.click(screen.getByRole('button',{name:'Continue editing'}));expect(screen.queryByText('These confirmed bookings may be affected')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Save changes'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(venue));
});
it('pending form submits do not write twice or close on Escape',async()=>{
 let resolve;api.put.mockImplementation(()=>new Promise(done=>{resolve=done;}));const close=vi.fn();render(<AddVenueModal venue={venue} onClose={close}/>);
 const form=screen.getByRole('button',{name:'Save changes'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);fireEvent.keyDown(document,{key:'Escape'});expect(api.put).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();await act(async()=>resolve({venue}));expect(close).toHaveBeenCalledOnce();
});
it('save failures without an error message use a readable fallback',async()=>{
 api.put.mockRejectedValue({});render(<AddVenueModal venue={venue} onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Save changes'}));expect((await screen.findByRole('alert')).textContent).toBe('Unable to save this venue.');
});
it('catalogue retrieval errors are shown and a configured stream URL is used',async()=>{
 let address;class Stream{constructor(url){address=url;}close(){}}
 vi.stubGlobal('EventSource',Stream);vi.stubEnv('VITE_API_URL','https://api.example.test/api');api.get.mockRejectedValue(new Error('Catalogue unavailable'));
 render(<VenueList/>);expect((await screen.findByRole('alert')).textContent).toBe('Catalogue unavailable');expect(address).toBe('https://api.example.test/api/venues/stream');
});
it('catalogue streaming uses the local API when no URL is configured',async()=>{
 let address;class Stream{constructor(url){address=url;}close(){}}vi.stubGlobal('EventSource',Stream);vi.stubEnv('VITE_API_URL','');render(<VenueList/>);await screen.findByText('Test hall');expect(address).toBe('http://localhost:4000/api/venues/stream');
});
it('invalid lists, turnaround, operating hours and excessive hourly rate prevent all writes',()=>{
 render(<AddVenueModal venue={{...venue,pricing:'From $200'}} onClose={()=>{}}/>);expect(screen.getByText(/descriptive legacy price/)).toBeTruthy();
 for(const [label,value] of [['Facilities & amenities *',', ,'],['Turnaround time (minutes) *','-1'],['Opening time *','23:00']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.change(screen.getByPlaceholderText('Hourly rate (e.g. 500)'),{target:{value:'100000000'}});
 fireEvent.click(screen.getByRole('button',{name:'Save changes'}));for(const text of ['Enter at least one item.','Enter whole minutes between 0 and 10080.','Opening time must be before closing time.','Hourly rate must be no greater than $99,999,999.99.'])expect(screen.getByText(text)).toBeTruthy();expect(api.put).not.toHaveBeenCalled();
});
it('oversized images are rejected before reading',()=>{
 const view=render(<AddVenueModal venue={venue} onClose={()=>{}}/>);fireEvent.change(view.baseElement.querySelector('input[type="file"]'),{target:{files:[{type:'image/png',size:5*1024*1024+1}]}});expect(screen.getByRole('alert').textContent).toBe('Images must be 5 MB or smaller.');
});
it('map search and selection notify the form when location work starts and ends',async()=>{
 const pending=vi.fn(),changed=vi.fn();api.get.mockResolvedValueOnce([{location:'Selected address',latitude:1.3,longitude:103.85}]).mockResolvedValueOnce({location:'Resolved address',latitude:1.3,longitude:103.85,mrt:{name:'City Hall MRT'}});
 render(<LocationPicker value={{location:'Search address'}} onChange={changed} onPendingChange={pending}/>);fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.click(await screen.findByRole('button',{name:'Selected address'}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(pending.mock.calls.map(call=>call[0])).toEqual([true,false,true,false]);
});
it('rapid deactivation clicks issue only one mutation before React rerenders',async()=>{
 let finish;api.delete.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<VenueDetail venue={venue} canManage onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));const button=screen.getByRole('button',{name:'Confirm deactivation'});
 act(()=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});expect(api.delete).toHaveBeenCalledOnce();await act(async()=>finish({}));
});
