// File: Tests registration and retained draft forms, including pending submits, field payloads and server failures.
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ExternalRegister from '../../frontend/src/pages/external/ExternalRegister';
import PasswordReset from '../../frontend/src/pages/external/PasswordReset';
import EventForm from '../../frontend/src/pages/events/EventForm';
import {api} from '../../frontend/src/api/client';
const mocks=vi.hoisted(()=>({navigate:vi.fn(),logout:vi.fn()}));
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'session',logout:mocks.logout})}));
vi.mock('../../frontend/src/api/client',()=>({api:{post:vi.fn()}}));
vi.mock('react-router-dom',async()=>({...await vi.importActual('react-router-dom'),useNavigate:()=>mocks.navigate}));
beforeEach(()=>vi.clearAllMocks());afterEach(cleanup);
// Completes required external registration fields with matching confirmation.
function fill(){for(const [label,value] of [['Full name','Alice'],['Email','alice@example.test'],['Password','password123'],['Confirm password','password123']])fireEvent.change(screen.getByLabelText(label),{target:{value}});}
it('organiser signup sends optional organisation and matching confirmation; pending submits do not duplicate',async()=>{
 let finish;api.post.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<MemoryRouter><ExternalRegister/></MemoryRouter>);fill();fireEvent.change(screen.getByLabelText('Account type'),{target:{value:'event_organiser'}});fireEvent.change(screen.getByLabelText('Organisation name (optional)'),{target:{value:'Community group'}});
 const form=screen.getByRole('button',{name:'Create account'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledOnce();expect(api.post.mock.lastCall[1]).toMatchObject({role:'event_organiser',organisationName:'Community group',confirmation:'password123'});await act(async()=>finish({message:'Account created. Please sign in.'}));expect(screen.getByRole('link',{name:'Sign in'})).toBeTruthy();
});
it('reset form ignores duplicate submits until its request settles',async()=>{
 let finish;api.post.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<MemoryRouter><PasswordReset/></MemoryRouter>);fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'alice@example.test'}});const form=screen.getByRole('button',{name:'Send reset link'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledOnce();await act(async()=>finish({message:'Check email'}));
});
it('all event fields and registration requirements are serialized and displayed after saving',async()=>{
 api.post.mockResolvedValue({event:{id:15},message:'Event request submitted.'});render(<MemoryRouter><EventForm/></MemoryRouter>);
 for(const [label,value] of [['Event name','Workshop'],['Purpose','Learning'],['Description','An introduction'],['Event type','workshop'],['Proposed date','2030-10-15'],['Start time','09:00'],['End time','12:00'],['Expected attendance','50'],['Room layout preference','Theatre'],['Programme','Welcome'],['Accessibility needs (one per line)','Ramp\nHearing loop'],['Equipment requirements','Microphone'],['Special arrangements','Vegetarian lunch']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByLabelText('Requires attendee registration'));fireEvent.change(screen.getByLabelText('Registration capacity'),{target:{value:'45'}});fireEvent.click(screen.getByRole('button',{name:'Submit'}));
 await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith('/organizer/events/15',{state:{message:'Event request submitted.'}}));expect(api.post.mock.lastCall[1]).toMatchObject({expectedAttendance:50,registrationCapacity:45,accessibilityRequirements:['Ramp','Hearing loop'],registrationRequired:true,isDraft:false});
});
it('event save errors preserve the form and pending duplicate submits do not write again',async()=>{
 let reject;api.post.mockImplementation(()=>new Promise((_,bad)=>{reject=bad;}));render(<MemoryRouter><EventForm/></MemoryRouter>);fireEvent.change(screen.getByLabelText('Event name'),{target:{value:'Draft'}});const form=screen.getByRole('button',{name:'Submit'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledOnce();await act(async()=>reject(new Error('Unable to save event')));expect(screen.getByRole('alert').textContent).toBe('Unable to save event');expect(screen.getByLabelText('Event name').value).toBe('Draft');
});
