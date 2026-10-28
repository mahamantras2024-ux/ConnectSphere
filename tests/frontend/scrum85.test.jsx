// SCRUM-85: opt-in controls and live hold state through accessible UI; only the HTTP boundary is mocked.
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import CoordinatorReminderPreferences from '../../frontend/src/pages/coordinator/CoordinatorReminderPreferences';
import VenueHoldState from '../../frontend/src/pages/events/VenueHoldState';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),put:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.useRealTimers();});
it('SCRUM-85 AC9 - opting in persists the selected Venue Staff cadence for all pending review types',async()=>{
 api.get.mockResolvedValue({preference:{enabled:false,frequencyDays:1}});api.put.mockResolvedValue({preference:{enabled:true,frequencyDays:3}});
 render(<CoordinatorReminderPreferences token="session"/>);
 fireEvent.change(await screen.findByLabelText('Review reminder frequency'),{target:{value:'3'}});
 expect(api.put).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('checkbox',{name:'Receive periodic reminders for all pending reviews'}));
 await screen.findByText('Reminder preference saved.');
 expect(api.put).toHaveBeenCalledWith('/notifications/coordinator-preferences',{enabled:true,frequencyDays:3},'session');
 expect(screen.getByRole('option',{name:'Weekly'})).toHaveValue('7');
});
it('SCRUM-85 AC9 - enabled users can change cadence and disable future reminders',async()=>{
 api.get.mockResolvedValue({preference:{enabled:true,frequencyDays:1}});api.put.mockImplementation(async(_path,body)=>({preference:body}));
 render(<CoordinatorReminderPreferences token="session"/>);
 fireEvent.change(await screen.findByLabelText('Review reminder frequency'),{target:{value:'7'}});
 await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/notifications/coordinator-preferences',{enabled:true,frequencyDays:7},'session'));
 await waitFor(()=>expect(screen.getByRole('checkbox')).not.toBeDisabled());fireEvent.click(screen.getByRole('checkbox'));
 await waitFor(()=>expect(api.put).toHaveBeenLastCalledWith('/notifications/coordinator-preferences',{enabled:false,frequencyDays:7},'session'));
});
it('SCRUM-85 AC9 - failed saving preserves the previous preference and reports the failure',async()=>{
 api.get.mockResolvedValue({preference:{enabled:false,frequencyDays:1}});api.put.mockRejectedValue(new Error('Unable to save'));
 render(<CoordinatorReminderPreferences token="session"/>);fireEvent.click(await screen.findByRole('checkbox'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save');expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('SCRUM-85 AC9 - failed loading is visible rather than claiming reminders are enabled',async()=>{
 api.get.mockRejectedValue(new Error('Offline'));render(<CoordinatorReminderPreferences token="session"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Offline');expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('SCRUM-85 AC7 AC8 - open event switches from held to expired exactly at the saved expiry',async()=>{
 vi.useFakeTimers();const now=new Date('2031-10-20T02:00:00Z');vi.setSystemTime(now);
 render(<VenueHoldState booking={{status:'pending',hold_expires_at:new Date(now.getTime()+1000).toISOString()}}/>);
 expect(screen.getByText(/Hold state: Held/)).toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTime(999));expect(screen.getByText(/Hold state: Held/)).toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTime(1));expect(screen.getByText(/Hold state: Expired/)).toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTime(1));expect(screen.getByText(/Hold state: Expired/)).toBeInTheDocument();
});
it('SCRUM-85 AC8 - decided and legacy pending bookings show their current saved state',()=>{
 const view=render(<VenueHoldState booking={{status:'approved'}}/>);expect(screen.getByText(/Hold state: approved/)).toBeInTheDocument();
 view.rerender(<VenueHoldState booking={{status:'pending'}}/>);expect(screen.getByText(/No active hold/)).toBeInTheDocument();
});
it('SCRUM-85 AC2 AC3 - coordinator sees a committed decision before the ten-second limit without refreshing',async()=>{
 // Arrange: keep the real app/provider/polling; substitute only server responses and the clock.
 const {default:App}=await import('../../frontend/src/App');
 const {AuthProvider}=await import('../../frontend/src/context/AuthContext');
 const {MemoryRouter}=await import('react-router-dom');
 vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});vi.setSystemTime(new Date('2031-10-20T02:00:00Z'));
 localStorage.setItem('cs_token','session');let notifications=[];
 api.get.mockImplementation(async path=>{
  if(path==='/auth/me')return {user:{id:8,role:'event_coordinator',roles:['event_coordinator']}};
  if(path==='/notifications')return {notifications,unreadCount:notifications.length};
  if(path.endsWith('coordinator-preferences'))return {preference:{enabled:false,frequencyDays:1}};
  return {events:[],changeRequests:[],staff:[]};
 });
 render(<MemoryRouter initialEntries={['/coordinator/dashboard']}><AuthProvider><App/></AuthProvider></MemoryRouter>);
 await screen.findByRole('button',{name:'Notifications'});
 // Act: notification becomes available just after the initial read, the worst polling position.
 notifications=[{id:9,event_id:3,type:'event_details_changed',title:'Venue booking approved: Gala',message:'Hall A approved. Alternative: Hall B.',created_at:'2031-10-20T02:00:00Z',read_at:null}];
 await act(async()=>vi.advanceTimersByTime(4999));expect(screen.queryByRole('button',{name:'Notifications, 1 unread'})).not.toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTime(1));
 expect(await screen.findByRole('button',{name:'Notifications, 1 unread'})).toBeInTheDocument();
 // Assert: state remains visible immediately below, at and above the deadline; an implementation first polling after 10s fails above.
 for(const delta of [4999,1,1]){await act(async()=>vi.advanceTimersByTime(delta));expect(screen.getByRole('button',{name:'Notifications, 1 unread'})).toBeInTheDocument();}
 localStorage.clear();
});
it('SCRUM-85 AC9 - preference responses from an old session cannot update an unmounted control',async()=>{
 const pending=[];api.get.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
 let view=render(<CoordinatorReminderPreferences token="old"/>);view.unmount();pending[0].resolve({preference:{enabled:true,frequencyDays:7}});
 view=render(<CoordinatorReminderPreferences token="old"/>);view.unmount();pending[1].reject(new Error('Late failure'));
 await Promise.resolve();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('SCRUM-85 AC9 - missing preference data defaults to disabled instead of opting a coordinator in',async()=>{
 api.get.mockResolvedValue({});render(<CoordinatorReminderPreferences token="session"/>);
 expect(await screen.findByRole('checkbox')).not.toBeChecked();expect(screen.getByLabelText('Review reminder frequency')).toHaveValue('1');
});
for(const offset of [-1,0,1])it(`SCRUM-85 AC8 - opening a hold ${offset}ms from expiry displays its current state`,()=>{
 vi.useFakeTimers();const now=new Date('2031-10-20T02:00:00Z');vi.setSystemTime(now);
 render(<VenueHoldState booking={{status:'pending',hold_expires_at:new Date(now.getTime()+offset).toISOString()}}/>);
 expect(screen.getByText(offset<=0?/Hold state: Expired/:/Hold state: Held/)).toBeInTheDocument();
});
