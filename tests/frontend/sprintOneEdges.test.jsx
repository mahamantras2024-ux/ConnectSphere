// File: Exercises missing data, failed retrieval, session races and accessible interactions for Sprint 1.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { AuthProvider, useAuth } from '../../frontend/src/context/AuthContext';
import App from '../../frontend/src/App';
import Modal from '../../frontend/src/components/Modal';
import Dashboard from '../../frontend/src/pages/Dashboard';
import EventDetail from '../../frontend/src/pages/events/EventDetail';
import EventList from '../../frontend/src/pages/events/EventList';
import MyRegistrations from '../../frontend/src/pages/registrations/MyRegistrations';
vi.mock('../../frontend/src/api/client', () => ({ api:{get:vi.fn(),post:vi.fn()} }));
let user;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  user = {id:8,full_name:'Test Person',role:'event_organiser',roles:['event_organiser']};
  api.get.mockImplementation(async path => path==='/auth/me'?{user}:path==='/events'?{events:[]}:path==='/venues'?[]:{registrations:[]});
});
afterEach(() => {cleanup();vi.unstubAllGlobals();});
// Opens a component with the real authentication context and a provisioned session.
function open(component, path='/') {
  localStorage.setItem('cs_token','session');
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider>{component}</AuthProvider></MemoryRouter>);
}
it('missing paths show the useful not-found page and unknown roles show the fallback dashboard', async () => {
  open(<App/>,'/does-not-exist');expect(await screen.findByText(/not found/i)).toBeTruthy();cleanup();
  user={...user,role:'legacy_user'};open(<App/>,'/dashboard');expect(await screen.findByRole('heading',{name:'Welcome, Test Person'})).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('no available dashboard');expect(screen.queryByText(/TODO:/)).toBeNull();
});
it.each(['event_coordinator','event_organiser'])('lists %s events with honest missing values', async role => {
  user={...user,role};api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{events:[{id:9}]});
  open(<App/>,role==='event_organiser'?'/organizer/events':'/events');
  expect(await screen.findByText('Untitled Event')).toBeTruthy();expect(screen.getByText('No purpose provided')).toBeTruthy();expect(screen.getByText('Draft')).toBeTruthy();
});
it('empty, absent and failed event summaries are distinct and late requests cannot change a closed screen', async () => {
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{});open(<App/>,'/organizer/events');
  expect(await screen.findByText('You have not requested any events yet.')).toBeTruthy();cleanup();
  api.get.mockImplementation(async path=>{if(path==='/auth/me')return {user};throw new Error('Database offline');});open(<App/>,'/organizer/events');
  expect((await screen.findByRole('alert')).textContent).toBe('Database offline');cleanup();
  let finish;api.get.mockImplementation(path=>path==='/auth/me'?Promise.resolve({user}):new Promise(resolve=>{finish=resolve;}));
  const view=open(<App/>,'/organizer/events');await screen.findByText('Loading events...');view.unmount();await act(async()=>finish({events:[]}));
});
it('absent events and retrieval errors have clear independent states', async () => {
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:null});open(<App/>,'/organizer/events/7');
  expect(await screen.findByText('No event details available.')).toBeTruthy();cleanup();
  api.get.mockImplementation(async path=>{if(path==='/auth/me')return {user};throw {};});open(<App/>,'/organizer/events/7');
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load event details.');
});
it.each(['invalid','2030-02-30','2030-99-01'])('invalid calendar date %s is displayed as unavailable', async date=>{
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{id:7,name:'Incomplete event',proposed_date:date,purpose:{untrusted:true},accessibility_requirements:[null,12,' ','Ramp'],status:null,registration_required:false}});
  open(<App/>,'/organizer/events/7');await screen.findByText('Incomplete event');
  expect(screen.getByText('Ramp')).toBeTruthy();expect(screen.getByText('No')).toBeTruthy();expect(screen.getAllByText('Not specified').length).toBeGreaterThan(5);
});
it('late event details and errors after unmount do not restore a closed record', async () => {
  for (const fail of [false,true]) {
    let resolve,reject;api.get.mockImplementation(path=>path==='/auth/me'?Promise.resolve({user}):new Promise((done,bad)=>{resolve=done;reject=bad;}));
    const view=open(<App/>,'/organizer/events/7');await screen.findByText('Loading event details...');view.unmount();
    await act(async()=>fail?reject(new Error('Late error')):resolve({event:{name:'Late private record'}}));expect(screen.queryByText('Late private record')).toBeNull();
  }
});
it('registration summaries support absent results and absent event metadata', async()=>{
  user={...user,role:'attendee'};api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{});open(<App/>,'/registrations');await screen.findByText('No registrations yet');cleanup();
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{registrations:[{id:1,event_id:17,status:'registered'}]});open(<App/>,'/registrations');
  expect(await screen.findByRole('heading',{name:'Event #17'})).toBeTruthy();expect(screen.getByText('Date not specified')).toBeTruthy();
});
it('late registration responses and errors are ignored after the screen is closed',async()=>{
  user={...user,role:'attendee'};
  for(const fail of [false,true]) {let resolve,reject;api.get.mockImplementation(path=>path==='/auth/me'?Promise.resolve({user}):new Promise((done,bad)=>{resolve=done;reject=bad;}));
    const view=open(<App/>,'/registrations');await screen.findByText('Loading registrations...');view.unmount();await act(async()=>fail?reject(new Error('Late')):resolve({registrations:[]}));}
});
it('dialog Tab and Shift+Tab wrap focus and closing restores scrolling',()=>{
  document.body.style.overflow='auto';const close=vi.fn();const view=render(<Modal title="Test" onClose={close}><input aria-label="Field"/><button>Last</button></Modal>);
  const panel=screen.getByRole('dialog'),first=screen.getByRole('button',{name:'Close dialog'}),last=screen.getByRole('button',{name:'Last'});
  fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(first);
  last.focus();fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(first);
  first.focus();fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(last);
  panel.focus();fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(last);
  screen.getByLabelText('Field').focus();fireEvent.keyDown(document,{key:'Tab'});
  fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalledOnce();
  panel.querySelectorAll('button,input').forEach(node=>node.remove());const empty=new KeyboardEvent('keydown',{key:'Tab',cancelable:true,bubbles:true});document.dispatchEvent(empty);expect(empty.defaultPrevented).toBe(true);
  view.unmount();expect(document.body.style.overflow).toBe('auto');
});
it('login without audience and a superseded sign-in cannot restore the session',async()=>{
  let auth,finish;function Probe(){auth=useAuth();return <span>{auth.user?.role||'Signed out'}</span>;}
  api.get.mockResolvedValue({user});render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('Signed out');
  api.post.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));let pending;act(()=>{pending=auth.login('a@example.test','password123');});act(()=>auth.logout());
  await act(async()=>{finish({token:'late',user});await expect(pending).rejects.toThrow('no longer active');});
  expect(localStorage.getItem('cs_token')).toBeNull();expect(api.post.mock.calls[0][1]).toEqual({email:'a@example.test',password:'password123'});
});
it('late rejected session restoration cannot clear a newer session',async()=>{
  let auth,reject;function Probe(){auth=useAuth();return <span>{auth.user?.role||'Signed out'}</span>;}
  localStorage.setItem('cs_token','old');api.get.mockImplementation(()=>new Promise((_,bad)=>{reject=bad;}));render(<AuthProvider><Probe/></AuthProvider>);
  act(()=>auth.logout());await act(async()=>reject(new Error('Old session')));expect(localStorage.getItem('cs_token')).toBeNull();
});
it('internal logout returns to staff sign-in and unknown role labels remain readable',async()=>{
 user={...user,role:'legacy_user',roles:['legacy_user','attendee']};open(<App/>,'/dashboard');await screen.findByText('Welcome, Test Person');expect(screen.getByRole('option',{name:'legacy_user'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Log out'}));expect(await screen.findByRole('button',{name:'Login'})).toBeTruthy();expect(screen.getByText(/Staff accounts/)).toBeTruthy();expect(localStorage.getItem('cs_token')).toBeNull();
});
it('external logout returns to external sign-in',async()=>{
 user={...user,role:'attendee'};open(<App/>,'/attendee/dashboard');await screen.findByRole('heading',{name:'Attendee Dashboard'});fireEvent.click(screen.getByRole('button',{name:'Log out'}));expect(await screen.findByRole('heading',{name:'Sign in'})).toBeTruthy();expect(localStorage.getItem('cs_token')).toBeNull();
});
it('authentication consumers outside their provider fail with a clear configuration error',()=>{
 const quiet=vi.spyOn(console,'error').mockImplementation(()=>{});function Probe(){useAuth();return null;}
 expect(()=>render(<Probe/>)).toThrow('useAuth must be used within AuthProvider');quiet.mockRestore();
});
it('an event with no recorded registration setting is explicitly marked unavailable',async()=>{
 api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{id:7,name:'No registration setting'}});open(<App/>,'/organizer/events/7');await screen.findByText('No registration setting');
 const label=screen.getByText('Registration Required');expect(label.parentElement.textContent).toMatch(/Not specified/);
});
