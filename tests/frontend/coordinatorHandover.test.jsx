// Handover AC3: history renders recorded identities, handles empty/error states and ignores stale responses.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import CoordinatorAssignmentHistory from '../../frontend/src/pages/events/CoordinatorAssignmentHistory';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const handover = {id:1,previous_coordinator_id:2,new_coordinator_id:3,changed_by:5,previous_name:'Chris',new_name:'Cara',changed_by_name:'Lead Lee',changed_at:'2030-01-02T02:00:00Z'};
/** Real table markup and API state transitions are exercised; only network I/O is replaced. */
function open() { return render(<CoordinatorAssignmentHistory eventId={1} token="session" updatedAt="2030-01-02" />); }
it('Handover AC3 - lists both recorded coordinators, Lead and Singapore timestamp in a table', async () => {
  api.get.mockResolvedValue({history:[handover]});open();
  const table = await screen.findByRole('table',{name:'Coordinator assignment history'});
  expect(within(table).getAllByRole('columnheader').map(header=>header.textContent)).toEqual(['Date and time','Previous coordinator','New coordinator','Changed by']);
  const row=within(table).getAllByRole('row')[1];
  expect(row.textContent).toContain('Chris');expect(row.textContent).toContain('Cara');expect(row.textContent).toContain('Lead Lee');expect(row.textContent).toMatch(/2 Jan 2030.*10:00 am/);
  expect(api.get).toHaveBeenCalledWith('/events/1/assignment-history','session');
});
it('Handover AC3 - initial assignments and missing historical names retain explicit identities', async () => {
  api.get.mockResolvedValue({history:[{...handover,previous_coordinator_id:null,new_name:null,changed_by_name:null},{...handover,id:2,previous_name:null}]});open();
  expect(await screen.findByText('Unassigned')).toBeTruthy();expect(screen.getByText('Coordinator #3')).toBeTruthy();expect(screen.getByText('Coordinator #2')).toBeTruthy();expect(screen.getByText('Lead #5')).toBeTruthy();
});
it('Handover AC3 - distinguishes loading and an event without recorded changes', async () => {
  let finish;api.get.mockReturnValue(new Promise(resolve=>{finish=resolve;}));open();
  expect(screen.getByRole('status').textContent).toBe('Loading coordinator history…');
  finish({history:[]});expect(await screen.findByText('No coordinator changes recorded yet.')).toBeTruthy();
});
it('Handover AC3 - reports an unavailable history without showing stale rows', async () => {
  api.get.mockRejectedValue(new Error('History unavailable'));open();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','History unavailable');expect(screen.queryByRole('table')).toBeNull();
});
it('Handover AC3 - handles older API responses and ignores requests completed after leaving the event', async () => {
  api.get.mockResolvedValue({});open();await screen.findByText('No coordinator changes recorded yet.');cleanup();
  let finish;api.get.mockReturnValue(new Promise(resolve=>{finish=resolve;}));open();cleanup();finish({history:[handover]});await Promise.resolve();
  let fail;api.get.mockReturnValue(new Promise((_,reject)=>{fail=reject;}));open();cleanup();fail(new Error('Late error'));await Promise.resolve();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('Handover AC3 - refreshed event data triggers a new history read', async () => {
  api.get.mockResolvedValueOnce({history:[]}).mockResolvedValue({history:[handover]});const view=open();await screen.findByText('No coordinator changes recorded yet.');
  view.rerender(<CoordinatorAssignmentHistory eventId={1} token="session" updatedAt="2030-01-03" />);
  expect(await screen.findByText('Chris')).toBeTruthy();await waitFor(()=>expect(api.get).toHaveBeenCalledTimes(2));
});
