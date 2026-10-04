// File: Tests that each role has one canonical workspace tab instead of duplicate dashboard/data links.
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, expect, it, vi} from 'vitest';
import App from '../../frontend/src/App';
import {AuthProvider} from '../../frontend/src/context/AuthContext';
import {api} from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client',()=>({api:{get:vi.fn(),post:vi.fn()}}));
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();});
it.each([
  ['event_organiser','/organizer/dashboard','My Events','Event Organiser Dashboard'],
  ['event_coordinator','/coordinator/dashboard','Assigned Events','Event Coordinator Dashboard'],
  ['attendee','/attendee/dashboard','My Registrations','Attendee Dashboard'],
])('UI navigation AC1 / login AC3 - %s has one active workspace tab that returns from other pages',async(role,path,label,title)=>{
  // Arrange a real session and an empty, owner-scoped response from the API boundary.
  localStorage.setItem('cs_token','session');
  api.get.mockImplementation(async endpoint=>endpoint==='/auth/me'?{user:{id:8,full_name:'Test User',role}}:endpoint==='/registrations/mine'?{registrations:[]}:{events:[]});
  render(<MemoryRouter initialEntries={['/missing-page']}><AuthProvider><App/></AuthProvider></MemoryRouter>);
  const nav=within(await screen.findByRole('navigation',{name:'Main navigation'}));
  const link=await nav.findByRole('link',{name:label});
  expect(nav.queryByRole('link',{name:'Dashboard'})).toBeNull();
  expect(link.getAttribute('href')).toBe(path);
  // Act: use the single workspace control, rather than relying on a redirect.
  fireEvent.click(link);
  // Assert: the real role screen opens and the tab identifies the current workspace.
  expect(await screen.findByRole('heading',{name:title})).toBeTruthy();
  expect(link.getAttribute('aria-current')).toBe('page');
  expect(nav.getAllByRole('link')).toHaveLength(2); // Brand plus one workspace tab.
});
