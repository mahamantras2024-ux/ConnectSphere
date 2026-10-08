import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import CoordinatorLeadDashboard from '../../frontend/src/pages/coordinator/CoordinatorLeadDashboard';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
const loadWorkspace = vi.fn();
const leadUser = {id:1,full_name:'Lead',email:'lead@example.com',role:'event_coordinator_lead'};
const event = { id: 7, name: 'Workshop', purpose: 'Learning', status: 'submitted', coordinator_id: null, organiser_name: 'Alice', proposed_date: '2026-10-10', expected_attendance: 40 };
/** Renders real lead controls, routing and authentication; only API network I/O is mocked. */
function open() { localStorage.setItem('cs_token','lead'); render(<MemoryRouter><AuthProvider><CoordinatorLeadDashboard /></AuthProvider></MemoryRouter>); }
beforeEach(() => {
  // Arrange API identity and workspace responses independently while keeping the session lifecycle real.
  vi.resetAllMocks(); localStorage.clear();
  api.get.mockImplementation(path => {
    if(path === '/auth/me') return Promise.resolve({user:leadUser});
    if(path === '/events/assignments') return loadWorkspace();
    throw new Error('Unexpected test API route: '+path);
  }); loadWorkspace.mockResolvedValue({ events: [event], coordinators: [{ id: 3, full_name: 'Chris', email: 'chris@example.com' }, { id: 4, full_name: 'Sam', email: 'sam@example.com' }] }); });
afterEach(cleanup);
// Arrange unassigned event; Act assign and then reassign; Assert queue membership and exact optimistic preconditions.
it('AC1 AC2 AC3 AC5 - reviews queue and assigns then reassigns an event', async () => {
  api.put.mockResolvedValueOnce({ event: { ...event, coordinator_id: 3 }, message: 'Saved' }).mockResolvedValueOnce({ event: { ...event, coordinator_id: 4 }, message: 'Reassigned' });
  open(); await screen.findByText('Workshop');
  expect(screen.getByText('Alice')).toBeTruthy(); expect(screen.getByText('40')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Coordinator for Workshop'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign coordinator' }));
  await screen.findByRole('button', { name: 'Reassign coordinator' });
  expect(api.put).toHaveBeenCalledWith('/events/7/assignment', { coordinatorId: 3, expectedCoordinatorId: null }, 'lead');
  expect(screen.getByText('No unassigned requests.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Coordinator for Workshop'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reassign coordinator' }));
  await screen.findByText('Reassigned');
  expect(api.put).toHaveBeenLastCalledWith('/events/7/assignment', { coordinatorId: 4, expectedCoordinatorId: 3 }, 'lead');
});
// Failure must preserve review controls and allow refresh instead of presenting a successful assignment.
it('AC2 AC3 - stale assignment remains reviewable and refresh recovers', async () => {
  api.put.mockRejectedValue(new Error('Assignment changed.'));
  open(); await screen.findByText('Workshop');
  fireEvent.change(screen.getByLabelText('Coordinator for Workshop'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign coordinator' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Assignment changed.');
  expect(screen.getByRole('button', { name: 'Assign coordinator' })).toBeTruthy();
  // The reread returns a different persisted assignment; a request count alone cannot prove recovery.
  loadWorkspace.mockResolvedValueOnce({events:[{...event,coordinator_id:4,coordinator_name:'Sam'}],coordinators:[{id:3,full_name:'Chris',email:'chris@example.com'},{id:4,full_name:'Sam',email:'sam@example.com'}]});
  fireEvent.click(screen.getByRole('button', { name: 'Refresh assignments' }));
  await screen.findByText('Sam');
  expect(screen.getByText('No unassigned requests.')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Reassign coordinator'})).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
// Empty/error states must communicate genuine absence and keep retry available.
it('AC1 AC2 - failed retrieval retries to an empty queue without coordinators', async () => {
  loadWorkspace.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ events: [], coordinators: [] });
  open(); await screen.findByText('Offline');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh assignments' }));
  await screen.findByText('No unassigned requests.');
  expect(screen.getByText('No assigned active events.')).toBeTruthy();
  expect(screen.getByText(/No Event Coordinators are provisioned/)).toBeTruthy();
});

// AC2/AC5: a slow assignment permits one write, preserves the other event, and renders absent summaries honestly.
it('AC2 AC5 - pending assignment prevents duplicate writes and retains other cards', async () => {
  let finish;
  api.put.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  loadWorkspace.mockResolvedValue({ events: [event, { ...event, id: 8, name: 'Other request', purpose: null, proposed_date: null, expected_attendance: null }], coordinators: [{ id: 3, full_name: 'Chris', email: 'chris@example.com' }] });
  open(); await screen.findByText('Other request');
  expect(screen.getByText('Purpose not recorded')).toBeTruthy(); expect(screen.getAllByText('Not specified')).toHaveLength(2);
  const form = screen.getAllByRole('button', { name: 'Assign coordinator' })[0].closest('form');
  fireEvent.change(screen.getByLabelText('Coordinator for Workshop'), { target: { value: '3' } });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(api.put).toHaveBeenCalledTimes(1);
  finish({ event: { ...event, coordinator_id: 3 }, message: 'Saved' });
  await screen.findByRole('button', { name: 'Reassign coordinator' });
  expect(screen.getByText('Other request')).toBeTruthy();
});
