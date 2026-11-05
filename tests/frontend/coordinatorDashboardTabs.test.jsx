// Coordinator tabs AC3/AC5: real App routing, auth, EventList polling and event details; only HTTP is mocked.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}}));
const event={id:101,name:'Planning forum',purpose:'Community learning',status:'planning',coordinator_id:9,organiser_id:7};
let events;
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();
  events=[event,{...event,id:102,name:'Finished forum',status:'completed'}];
  api.get.mockImplementation(async path=>{
    if(path==='/auth/me')return {user:{id:9,full_name:'Chris',role:'event_coordinator'}};
    if(path==='/events')return {events};
    if(path==='/events/101')return {event};
    if(path==='/events/101/decision')return {status:'planning',readiness:[],allowed:{approved:false,rejected:false},blocked:{approved:{message:'Pending'},rejected:{message:'Pending'}}};
    return {events:[],staff:[],history:[],changeRequests:[],notifications:[],unreadCount:0};
  });
});
afterEach(cleanup);
/** Uses a bookmarked dashboard stage so real detail navigation must preserve both stage and unrelated parameters. */
function open(){localStorage.setItem('cs_token','tabs-session');render(<MemoryRouter initialEntries={['/coordinator/dashboard?stage=progress&keep=1']}><AuthProvider><App/></AuthProvider></MemoryRouter>);}

it('Coordinator tabs AC3 AC5 - View details returns to the bookmarked stage and live snapshots update its counts',async()=>{
  open();
  fireEvent.click(await screen.findByRole('link',{name:/View details/}));
  await screen.findByRole('heading',{name:event.name});
  const back=screen.getByRole('link',{name:'Back to Dashboard'});
  expect(back).toHaveAttribute('href','/coordinator/dashboard?stage=progress&keep=1');
  fireEvent.click(back);
  const progress=await screen.findByRole('tab',{name:/^In progress/});
  expect(progress).toHaveAttribute('aria-selected','true');
  expect(within(screen.getByRole('tabpanel')).getByRole('heading',{name:event.name})).toBeVisible();
  // A real focus refresh moves this event out of the selected group; the explicit empty selection remains bookmarked.
  events=events.map(item=>item.id===101?{...item,status:'completed'}:item);
  fireEvent(window,new Event('focus'));
  await waitFor(()=>expect(within(screen.getByRole('tab',{name:/^Completed/})).getByText('2')).toBeVisible());
  expect(progress).toHaveAttribute('aria-selected','true');
  expect(screen.getByText('No in progress events.')).toBeVisible();
  expect(within(screen.getByRole('tabpanel')).queryByRole('link',{name:/View details/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:/^Completed/}));
  expect(within(screen.getByRole('tabpanel')).getAllByRole('heading',{level:3}).map(item=>item.textContent)).toEqual(['Planning forum','Finished forum']);
});
