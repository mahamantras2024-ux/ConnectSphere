// File: Tests real staff account information instead of future-workflow placeholder panels.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import {cleanup, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import App from '../../frontend/src/App';
import {AuthProvider} from '../../frontend/src/context/AuthContext';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn()}}));
let user;
beforeEach(()=>{
  // Arrange the authenticated account returned by the actual session endpoint.
  localStorage.clear(); localStorage.setItem('cs_token','staff-session');vi.clearAllMocks();
  user={id:8,full_name:'Chris Lee',email:'chris@example.test',role:'technical_support',roles:['technical_support']};
  api.get.mockImplementation(async()=>({user}));
});
afterEach(cleanup);
// Opens the real protected route and authentication provider.
function open(path){render(<MemoryRouter initialEntries={[path]}><AuthProvider><App/></AuthProvider></MemoryRouter>);}
// Test case: Opens each internal profile workspace and checks stored account details without unimplemented task placeholders.
it.each([
  ['technical_support','/tech-support/dashboard','Technical Support Dashboard'],
  ['event_coordinator_lead','/coordinator-lead/dashboard','Coordinator Lead Dashboard'],
  ['safety_officer','/safety/dashboard','Safety Officer Dashboard'],
])('Internal AC3 / cleanup AC1 - %s displays stored account data without promised task placeholders',async(role,path,title)=>{
  user={...user,role,roles:[role]};open(path);
  expect(await screen.findByRole('heading',{name:title})).toBeTruthy();
  expect(screen.getByText('chris@example.test')).toBeTruthy();
  expect(screen.getByRole('heading',{name:'Account details'})).toBeTruthy();
  expect(screen.queryByText(/scheduled for a later sprint|workspace is ready/i)).toBeNull();
  expect(api.get.mock.calls.map(call=>call[0])).toEqual(['/auth/me']);
  expect(screen.getByRole('button',{name:'Log out'})).toBeTruthy();
});
// Test case: Returns missing profile fields and checks unavailable labels without invented personal data.
it('Internal AC3 / cleanup AC1 - absent account details are identified without fabricated personal information',async()=>{
  user={id:8,role:'technical_support'};open('/tech-support/dashboard');
  await screen.findByRole('heading',{name:'Account details'});
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
  expect(screen.getByLabelText('Provisioned workspaces').textContent).toBe('Technical Support');
});
// Test case: Returns multiple assigned roles and checks they appear as profile information without additional active-role grants.
it('Internal AC3 / enhancement role switching - the profile displays assigned roles without granting additional access',async()=>{
  user.roles=['technical_support','venue_staff'];open('/tech-support/dashboard');
  await screen.findByRole('heading',{name:'Account details'});
  expect(screen.getByLabelText('Provisioned workspaces').textContent).toBe('Technical Support, Venue Staff');
  expect(screen.queryByRole('button',{name:'Add venue'})).toBeNull();
});
