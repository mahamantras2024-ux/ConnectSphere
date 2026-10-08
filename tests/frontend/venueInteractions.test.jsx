// Sprint 2: SCRUM-35 Update Venue Record and SCRUM-36 Delete Venue Record; AC tags select relevant cases independently.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
// File: Tests venue drawer actions, map failures, refresh cleanup, image errors and editing interactions.
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
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
// Test case: Returns wrapped/sparse venues and settles requests after unmount, checking unavailable labels and ignored late data.
it('handles object catalogues and missing details without fictional values',async()=>{
 api.get.mockResolvedValue({venues:[{id:7,name:'Sparse venue'}]});render(<VenueList/>);
 await screen.findByText('Sparse venue');expect(screen.getByText('Location not specified')).toBeTruthy();expect(screen.getByText('Hours not specified')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/View details/}));expect(screen.getAllByText('Not specified').length).toBeGreaterThan(4);
 fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));expect(screen.queryByRole('dialog')).toBeNull();cleanup();
 api.get.mockResolvedValue({});render(<VenueList/>);await screen.findByText('No venues found. Add a venue to start your catalogue.');cleanup();
});
// Test case: A refresh (browser focus) starts a newer catalogue load while an older one is still pending; the late older answer must not replace newer data.
it.each([['success'],['failure']])('a late %s from an older catalogue load does not replace a newer refresh',async outcome=>{
 // Arrange: the first load stays pending; the refresh answers with the current catalogue.
 let settleOld;
 api.get.mockImplementationOnce(()=>new Promise((done,bad)=>{settleOld={done,bad};})).mockResolvedValueOnce([{...venue,name:'Current hall'}]);
 render(<VenueList/>);
 // Act
 act(()=>{window.dispatchEvent(new Event('focus'));});
 expect(await screen.findByText('Current hall')).toBeTruthy();
 await act(async()=>outcome==='success'?settleOld.done([{...venue,name:'Stale hall'}]):settleOld.bad(new Error('Late failure')));
 // Assert
 expect(screen.getByText('Current hall')).toBeTruthy();
 expect(screen.queryByText('Stale hall')).toBeNull();
 expect(screen.queryByRole('alert')).toBeNull();
});
// Test case: Removes a venue from simulated results and checks focus refresh closes its drawer; fake-time polling also refreshes the catalogue.
it('[SCRUM-35 AC1; SCRUM-36 AC1] - focus and fallback polling refresh the catalogue and close a removed open record',async()=>{
 render(<VenueList/>);fireEvent.click(await screen.findByRole('button',{name:/View details/}));api.get.mockResolvedValue([]);
 fireEvent(window,new Event('focus'));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());cleanup();
 vi.useFakeTimers();render(<VenueList/>);await act(async()=>{});const count=api.get.mock.calls.length;
 await act(async()=>vi.advanceTimersByTime(20000));expect(api.get.mock.calls.length).toBe(count+1);
});
// Test case: Edits through the drawer and checks simulated saving, success feedback and return to the updated profile.
it('[SCRUM-35 AC1] - editing from the drawer saves and returns to the updated profile',async()=>{
 api.put.mockResolvedValue({venue:{...venue,name:'Updated hall',revision:1}});api.get.mockResolvedValueOnce([venue]).mockResolvedValue([{...venue,name:'Updated hall',revision:1}]);
 render(<VenueList/>);fireEvent.click(await screen.findByRole('button',{name:/View details/}));fireEvent.click(screen.getByRole('button',{name:'Edit venue'}));
 fireEvent.change(screen.getByLabelText('Venue name *'),{target:{value:'Updated hall'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(await screen.findByText('Venue updated and shared with the catalogue.')).toBeTruthy();expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Venue Details');
});
// Test case: Cancels deactivation without an API call, then fails confirmation and checks its error remains visible.
it('[SCRUM-36 AC1/AC2] - cancelled deactivation never reaches the API and failures without booking metadata still show errors',async()=>{
 api.delete.mockRejectedValue(new Error('Unable to deactivate'));render(<VenueDetail venue={venue} canManage onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));fireEvent.click(screen.getByRole('button',{name:'Keep venue'}));expect(api.delete).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));fireEvent.click(screen.getByRole('button',{name:'Confirm deactivation'}));expect((await screen.findByRole('alert')).textContent).toBe('Unable to deactivate');
});
// Test case: Leaves deactivation pending and checks Escape/repeated clicks cannot close or resubmit.
it('[SCRUM-36 AC2] - a pending deactivation cannot close the drawer or submit twice',async()=>{
 let finish;api.delete.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const close=vi.fn();render(<VenueDetail venue={venue} canManage onClose={close}/>);
 fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));fireEvent.click(screen.getByRole('button',{name:'Confirm deactivation'}));
 fireEvent.keyDown(document,{key:'Escape'});fireEvent.click(screen.getByRole('button',{name:'Checking bookings…'}));expect(close).not.toHaveBeenCalled();expect(api.delete).toHaveBeenCalledOnce();
 await act(async()=>finish({}));expect(close).toHaveBeenCalledOnce();
});
// Test case: Opens null/legacy venue data and checks absent records render nothing while legacy fields remain readable.
it('missing records render nothing and legacy camel-case fields remain readable',()=>{
 const first=render(<VenueDetail venue={null} onClose={()=>{}}/>);expect(first.container.firstChild).toBeNull();first.unmount();
 render(<VenueDetail venue={{name:'Legacy',address:'Legacy address',facilities:'Wi-Fi',accessibilityFeatures:'Ramp',supportedLayouts:'Theatre',operatingHours:'09:00 - 18:00',availabilityStatus:'Maintenance',setupMinutes:10,turnaroundMinutes:20,mrtInfo:'City Hall MRT',price:'25',image:'https://example.test/image.jpg'}} onClose={()=>{}}/>);
 for(const value of ['Legacy address','Ramp','Theatre','09:00 - 18:00','Maintenance','10 minutes','20 minutes','City Hall MRT','$25/hr'])expect(screen.getByText(value)).toBeTruthy();
});
// Test case: Opens missing versus zero time buffers and checks unavailable versus actual zero-minute labels.
it('missing venue durations are unavailable while explicitly saved zero durations remain zero',()=>{
 const view=render(<VenueDetail venue={venue} onClose={()=>{}}/>);for(const label of ['Setup time','Turnaround time'])expect(screen.getByText(label).parentElement.textContent).toMatch(/Not specified/);view.unmount();
 render(<VenueDetail venue={{...venue,setup_minutes:0,turnaround_minutes:0}} onClose={()=>{}}/>);expect(screen.getAllByText('0 minutes')).toHaveLength(2);
});
// Test case: Displays proxy booking warnings with missing metadata and checks event-ID/time fallbacks without inventing details.
it('[SCRUM-35 AC2; SCRUM-36 AC2] - booking warnings render unknown names, missing times, statuses and reasons honestly',()=>{
 const view=render(<BookingImpactList/>);expect(screen.queryAllByRole('listitem')).toHaveLength(0);view.unmount();
 render(<BookingImpactList bookings={[{booking_id:2,event_id:5,status:'pending'}]}/>);expect(screen.getByText('Event 5')).toBeTruthy();expect(screen.getByText(/Time not specified/)).toBeTruthy();
});
// Test case: Tries short queries, empty searches and provider errors and checks clear feedback with no invalid-query request.
it('short queries, empty search results and address-service failures stay visible',async()=>{
 render(<LocationPicker value={{}} onChange={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(screen.getByRole('alert').textContent).toMatch(/at least three/);expect(api.get).not.toHaveBeenCalled();
 fireEvent.change(screen.getByPlaceholderText('Location / Address *'),{target:{value:'Hall'}});api.get.mockResolvedValue([]);fireEvent.keyDown(screen.getByPlaceholderText('Location / Address *'),{key:'Enter'});expect((await screen.findByRole('alert')).textContent).toMatch(/No matching/);
 api.get.mockRejectedValue(new Error('Provider offline'));fireEvent.click(screen.getByRole('button',{name:'Search'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('Provider offline'));
});
// Test case: Clicks the map and checks resolved location/MRT; provider failure must preserve the previous selection.
it('map clicks calculate a selected location and failures preserve the previous selection',async()=>{
 const changed=vi.fn();api.get.mockResolvedValue({latitude:1.3,longitude:103.85,location:'Map address',mrt:{name:'City Hall MRT',distanceM:25}});
 function Form(){const [value,setValue]=useState({location:'Previous address'});return <LocationPicker value={value} onChange={next=>{changed(next);setValue(next);}}/>;}
 render(<Form/>);fireEvent.click(screen.getByRole('button',{name:'Map point'}));expect(await screen.findByText('City Hall MRT')).toBeTruthy();expect(changed.mock.lastCall[0].location).toBe('Map address');
 api.get.mockRejectedValue(new Error('Unable to resolve location'));fireEvent.click(screen.getByRole('button',{name:'Map point'}));expect((await screen.findByRole('alert')).textContent).toBe('Unable to resolve location');expect(changed).toHaveBeenCalledOnce();
});
// Test case: Closes or changes location while requests are pending and checks obsolete results cannot overwrite state.
it('late map and search responses cannot overwrite a newer selection or a closed form',async()=>{
 const pending=[];api.get.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));const changed=vi.fn(),view=render(<LocationPicker value={{location:'Previous'}} onChange={changed}/>);
 fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.click(screen.getByRole('button',{name:'Map point'}));
 await act(async()=>pending[0].resolve([]));expect(screen.queryByRole('alert')).toBeNull();
 view.unmount();await act(async()=>pending[1].resolve({location:'Late',mrt:{name:'Late'}}));expect(changed).not.toHaveBeenCalled();
});
// Test case: Pressing Enter starts a newer search while an older one is pending; the older search's late failure must not show over the newer results.
it('a late failure from a superseded address search is not shown',async()=>{
 const pending=[];api.get.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
 render(<LocationPicker value={{location:'Previous'}} onChange={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Search'}));
 fireEvent.keyDown(screen.getByPlaceholderText('Location / Address *'),{key:'Enter'});
 expect(pending).toHaveLength(2);
 await act(async()=>pending[1].resolve([{location:'Current address',latitude:1.3,longitude:103.8}]));
 await act(async()=>pending[0].reject(new Error('Late error')));
 expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByRole('button',{name:'Current address'})).toBeTruthy();
});
// Test case: A newer map point replaces an older pending one; the older point's late failure must not show an error or change the chosen location.
it('a late failure from a superseded map point is not shown',async()=>{
 const pending=[];const changed=vi.fn();api.get.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
 render(<LocationPicker value={{location:'Previous'}} onChange={changed}/>);
 fireEvent.click(screen.getByRole('button',{name:'Map point'}));
 fireEvent.click(screen.getByRole('button',{name:'Map point'}));
 await act(async()=>pending[1].resolve({location:'Current point',mrt:{name:'Current MRT'}}));
 await act(async()=>pending[0].reject(new Error('Late error')));
 expect(screen.queryByRole('alert')).toBeNull();
 expect(changed).toHaveBeenCalledTimes(1);
 expect(changed.mock.calls[0][0].location).toBe('Current point');
});
// Test case: Simulates image read failure/replacement and checks the error, reader cancellation and new preview.
it('[SCRUM-35 AC1] - image read failures show a useful error and a second upload cancels the first reader',()=>{
 const readers=[];class Reader {constructor(){readers.push(this);}abort=vi.fn();readAsDataURL=vi.fn();}
 vi.stubGlobal('FileReader',Reader);const view=render(<AddVenueModal venue={venue} onClose={()=>{}}/>);const input=view.baseElement.querySelector('input[type="file"]');
 fireEvent.change(input,{target:{files:[]}});expect(readers).toHaveLength(0);
 fireEvent.change(input,{target:{files:[new File(['image'],'a.png',{type:'image/png'})]}});act(()=>readers[0].onerror());expect(screen.getByRole('alert').textContent).toMatch(/Unable to read/);
 fireEvent.change(input,{target:{files:[new File(['image'],'b.png',{type:'image/png'})]}});expect(readers[0].abort).toHaveBeenCalledOnce();readers[1].result='data:image/png;base64,YQ==';act(()=>readers[1].onload());expect(screen.getByAltText('Venue preview').src).toContain('data:image/png');
});
// Test case: Changes availability/buffers/hours, receives a proxy warning and checks Continue editing permits the later save.
it('[SCRUM-35 AC1/AC2] - form controls save optional fields and warnings can be dismissed for further editing',async()=>{
 const save=vi.fn();api.put.mockRejectedValueOnce(Object.assign(new Error('Review'),{details:{code:'BOOKING_IMPACT',confirmationToken:'token',affectedBookings:[]}})).mockResolvedValueOnce(venue);
 render(<AddVenueModal venue={venue} onClose={()=>{}} onAdd={save}/>);
 fireEvent.change(screen.getByLabelText('Availability'),{target:{value:'Maintenance'}});fireEvent.change(screen.getByLabelText('Turnaround time (minutes) *'),{target:{value:'30'}});
 fireEvent.change(screen.getByLabelText('Closing time *'),{target:{value:'20:00'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));await screen.findByText('These confirmed bookings may be affected');
 fireEvent.click(screen.getByRole('button',{name:'Continue editing'}));expect(screen.queryByText('These confirmed bookings may be affected')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Save changes'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(venue));
});
// Test case: Submits twice while saving and checks one update request and no Escape closure before completion.
it('[SCRUM-35 AC1] - pending form submits do not write twice or close on Escape',async()=>{
 let resolve;api.put.mockImplementation(()=>new Promise(done=>{resolve=done;}));const close=vi.fn();render(<AddVenueModal venue={venue} onClose={close}/>);
 const form=screen.getByRole('button',{name:'Save changes'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);fireEvent.keyDown(document,{key:'Escape'});expect(api.put).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();await act(async()=>resolve({venue}));expect(close).toHaveBeenCalledOnce();
});
// Test case: Fails saving without a message and checks the unable-to-save fallback.
it('[SCRUM-35 AC1] - save failures without an error message use a readable fallback',async()=>{
 api.put.mockRejectedValue({});render(<AddVenueModal venue={venue} onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Save changes'}));expect((await screen.findByRole('alert')).textContent).toBe('Unable to save this venue.');
});
// Test case: Fails catalogue retrieval with a configured URL and checks the error and event-stream endpoint.
it('catalogue retrieval errors are shown and a configured stream URL is used',async()=>{
 let address;class Stream{constructor(url){address=url;}close(){}}
 vi.stubGlobal('EventSource',Stream);vi.stubEnv('VITE_API_URL','https://api.example.test/api');api.get.mockRejectedValue(new Error('Catalogue unavailable'));
 render(<VenueList/>);expect((await screen.findByRole('alert')).textContent).toBe('Catalogue unavailable');expect(address).toBe('https://api.example.test/api/venues/stream');
});
// Test case: Leaves the API URL unset and checks streaming uses the local backend.
it('catalogue streaming uses the local API when no URL is configured',async()=>{
 let address;class Stream{constructor(url){address=url;}close(){}}vi.stubGlobal('EventSource',Stream);vi.stubEnv('VITE_API_URL','');render(<VenueList/>);await screen.findByText('Test hall');expect(address).toBe('http://localhost:4000/api/venues/stream');
});
// Test case: Submits invalid facilities/buffers/hours/price and checks every validation error without an update.
it('[SCRUM-35 AC1] - invalid lists, turnaround, operating hours and excessive hourly rate prevent all writes',()=>{
 render(<AddVenueModal venue={{...venue,pricing:'From $200'}} onClose={()=>{}}/>);expect(screen.getByText(/descriptive legacy price/)).toBeTruthy();
 for(const [label,value] of [['Facilities & amenities *',', ,'],['Turnaround time (minutes) *','-1'],['Opening time *','23:00']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.change(screen.getByPlaceholderText('Hourly rate (e.g. 500)'),{target:{value:'100000000'}});
 fireEvent.click(screen.getByRole('button',{name:'Save changes'}));for(const text of ['Enter at least one item.','Enter whole minutes between 0 and 10080.','Opening time must be before closing time.','Hourly rate must be no greater than $99,999,999.99.'])expect(screen.getByText(text)).toBeTruthy();expect(api.put).not.toHaveBeenCalled();
});
// Test case: Selects an image larger than five megabytes and checks rejection before reading.
it('[SCRUM-35 AC1] - oversized images are rejected before reading',()=>{
 const view=render(<AddVenueModal venue={venue} onClose={()=>{}}/>);fireEvent.change(view.baseElement.querySelector('input[type="file"]'),{target:{files:[{type:'image/png',size:5*1024*1024+1}]}});expect(screen.getByRole('alert').textContent).toBe('Images must be 5 MB or smaller.');
});
// Test case: Searches/selects an address and checks pending notifications at each request start/end.
it('map search and selection notify the form when location work starts and ends',async()=>{
 const pending=vi.fn(),changed=vi.fn();api.get.mockResolvedValueOnce([{location:'Selected address',latitude:1.3,longitude:103.85}]).mockResolvedValueOnce({location:'Resolved address',latitude:1.3,longitude:103.85,mrt:{name:'City Hall MRT'}});
 render(<LocationPicker value={{location:'Search address'}} onChange={changed} onPendingChange={pending}/>);fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.click(await screen.findByRole('button',{name:'Selected address'}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(pending.mock.calls.map(call=>call[0])).toEqual([true,false,true,false]);
});
// Test case: Dispatches two deactivate clicks before rerender and checks a single simulated delete request.
it('[SCRUM-36 AC1] - rapid deactivation clicks issue only one mutation before React rerenders',async()=>{
 let finish;api.delete.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<VenueDetail venue={venue} canManage onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Deactivate venue'}));const button=screen.getByRole('button',{name:'Confirm deactivation'});
 act(()=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});expect(api.delete).toHaveBeenCalledOnce();await act(async()=>finish({}));
});

// Test case: Opens a complete catalogue record and checks every required profile field, transit information and right-side drawer; Close returns to the catalogue.
it('View venue AC1/AC2 - catalogue details show saved venue information and close back to the list',async()=>{
 const profile={...venue,name:'Marina Hall',location:'Marina',capacity:80,facilities:['Wi-Fi','Projector'],accessibility_features:['Wheelchair access'],supported_layouts:['Theatre','Banquet'],operating_hours:'09:00 - 18:00',mrt:'Marina Bay MRT'};
 api.get.mockResolvedValue([profile]);render(<VenueList/>);fireEvent.click(await screen.findByRole('button',{name:/view details/i}));
 const drawer=screen.getByRole('dialog',{name:'Venue Details'});expect(drawer.classList.contains('venue-drawer')).toBe(true);
 expect(within(drawer).getByRole('heading',{name:'Marina Hall'})).toBeTruthy();
 for(const value of ['Marina','80 Guests','Wi-Fi, Projector','Wheelchair access','Theatre, Banquet','09:00 - 18:00','Marina Bay MRT'])expect(within(drawer).getByText(value)).toBeTruthy();
 expect(within(drawer).getByText(/older record has no map pin/i)).toBeTruthy();
 fireEvent.click(within(drawer).getByRole('button',{name:'Close dialog'}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('heading',{name:'Marina Hall'})).toBeTruthy();
});
