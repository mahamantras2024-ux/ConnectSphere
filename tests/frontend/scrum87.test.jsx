// SCRUM-87: actual auth, notification polling, controls and routing; only HTTP responses and the clock are external.
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import App from '../../frontend/src/App';
import {AuthProvider} from '../../frontend/src/context/AuthContext';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}}));
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();localStorage.clear();});
for(const [status,type]of [['Registered','event_details_changed'],['Waitlisted','event_details_changed'],['Withdrawn','event_details_changed'],['Moved off waitlist','waitlist_promoted'],['Cancelled','event_cancelled']])it(`SCRUM-87 AC1 AC2 - ${status} is visible before 10 seconds and opens the current event`,async()=>{
 // Arrange: a change immediately after the first read is the worst polling position.
 vi.useFakeTimers({toFake:['Date','setInterval','clearInterval','setTimeout','clearTimeout']});
 vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));localStorage.setItem('cs_token','attendee');
 let notes=[];
 api.get.mockImplementation(async path=>{
  if(path==='/auth/me')return{user:{id:8,role:'attendee',roles:['attendee']}};
  if(path==='/notifications')return{notifications:notes,unreadCount:notes.length};
  if(path==='/events/published/44')return{event:{id:44,name:'Arts Day',status:'cancelled',proposed_date:'2031-06-12',proposed_start_time:'09:00',proposed_end_time:'10:00',accessibility_requirements:[]}};
  return{events:[],registrations:[]};
 });
 // Mark-read returns the server contract while navigation continues through the real provider.
 api.post.mockImplementation(async()=>({notification:{...notes[0],read_at:'2031-06-01T00:00:10Z'}}));
 await act(async()=>{render(<MemoryRouter initialEntries={['/attendee/dashboard']}><AuthProvider><App/></AuthProvider></MemoryRouter>);});
 notes=[{id:9,event_id:44,type,title:`${status}: Arts Day`,message:`Arts Day: ${status}.`,created_at:'2031-06-01T00:00:00Z',read_at:null}];
 // Act / Assert: below, at and above the polling boundary; all remain comfortably inside the ten-second AC.
 await act(async()=>vi.advanceTimersByTime(4999));expect(screen.queryByRole('button',{name:'Notifications, 1 unread'})).toBeNull();
 for(const delta of [1,4999,1,1]){await act(async()=>vi.advanceTimersByTime(delta));expect(screen.getByRole('button',{name:'Notifications, 1 unread'})).toBeInTheDocument();}
 fireEvent.click(screen.getByRole('button',{name:'Notifications, 1 unread'}));
 await act(async()=>{fireEvent.click(within(screen.getByRole('region',{name:'Recent notifications'})).getByRole('button',{name:`${status}: Arts Day (new)`}));});
 expect(api.get).toHaveBeenCalledWith('/events/published/44','attendee');
 expect(screen.getByRole('heading',{name:'Arts Day'})).toBeInTheDocument();
});
