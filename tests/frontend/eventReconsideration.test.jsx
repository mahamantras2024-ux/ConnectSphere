// Reconsider AC2–AC4: real controls respect server eligibility, preserve history and recover from stale actions.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import EventReviewHistory from '../../frontend/src/pages/events/EventReviewHistory';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const rejection = { id: 1, kind: 'review', outcome: 'rejected', occurred_at: '2030-01-01T00:00:00Z', actor_name: 'Chris', details: { reason: 'Audience not explained' } };
const corrected = { id: 2, kind: 'correction', outcome: 'applied', occurred_at: '2030-01-02T00:00:00Z', details: { explanation: 'Audience corrected', changes: [{ field: 'purpose', label: 'Purpose', before: 'Vague', after: 'Community learning' }] } };
/** An actual rejected event and recorded history provide non-vacuous button/history assertions. */
function open({ status = 'rejected', coordinator = true, onReopened = vi.fn() } = {}) {
  render(<EventReviewHistory event={{id:1,status}} token="session" coordinator={coordinator} onReopened={onReopened} />);
  return onReopened;
}
it('Reconsider AC2 AC3 - shows rejection and corrections and reopens the displayed version', async () => {
  api.get.mockResolvedValue({ history: [rejection,corrected,{...rejection,id:3,kind:'reconsideration',outcome:'under_review',actor_name:null,details:{} }], rejectionId:1,blocked:null });
  let finish;
  api.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const changed = open();
  expect(await screen.findByText('Audience corrected')).toBeTruthy();
  expect(screen.getByText('Audience not explained')).toBeTruthy();
  expect(screen.getByText(/Vague.*Community learning/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Reopen for reconsideration'}));
  expect(screen.getByRole('button',{name:'Reopening…'}).disabled).toBe(true);
  finish({ event:{status:'under_review'},message:'Request reopened for review.' });
  expect(await screen.findByRole('status')).toHaveProperty('textContent','Request reopened for review.');
  expect(changed).toHaveBeenCalledWith('under_review');
  expect(api.post).toHaveBeenCalledWith('/events/1/reconsider',{rejectionId:1},'session');
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});
it('Reconsider AC2 - blocks uncorrected requests and handles pending history loading', async () => {
  let finish;
  api.get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  open();
  expect(screen.getByRole('button').disabled).toBe(true);
  finish({history:[rejection],rejectionId:1,blocked:{message:'Apply a recorded correction first.'}});
  expect(await screen.findByText('Apply a recorded correction first.')).toBeTruthy();
  expect(screen.getByRole('button').disabled).toBe(true);
});
it('Reconsider AC2 - reports a stale action and reloads eligibility without announcing success', async () => {
  api.get.mockResolvedValue({history:[rejection],rejectionId:1,blocked:null});
  api.post.mockRejectedValue(new Error('The review changed. Refresh.'));
  const changed = open();
  await screen.findByText('Audience not explained');
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','The review changed. Refresh.');
  expect(changed).not.toHaveBeenCalled();
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});
it.each(['cancelled','approved'])('Reconsider AC4 - %s has no reopen control and retains its history', async status => {
  api.get.mockResolvedValue({history:[rejection],blocked:null});
  open({status});
  await screen.findByText('Audience not explained');
  expect(screen.queryByRole('button')).toBeNull();
  if(status==='cancelled') expect(screen.getByText(/Submit a new event request/)).toBeTruthy();
});
it('Reconsider AC3 - organisers see history without coordinator actions and empty history is explained', async () => {
  api.get.mockResolvedValue({history:[],blocked:null});
  open({coordinator:false});
  expect(await screen.findByText('No review outcomes recorded yet.')).toBeTruthy();
  expect(within(screen.getByRole('region')).queryByRole('button')).toBeNull();
});
it('Reconsider AC3 - failed history reads remain explicit and cannot enable an action', async () => {
  api.get.mockRejectedValue(new Error('Unable to load review history.'));
  open();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','Unable to load review history.');
  expect(screen.getByRole('button').disabled).toBe(true);
});
it('Reconsider AC3 - ignores unsupported responses and results arriving after unmount', async () => {
  api.get.mockResolvedValue({}); open(); await waitFor(()=>expect(api.get).toHaveBeenCalled()); cleanup();
  let finish;api.get.mockReturnValue(new Promise(resolve=>{finish=resolve;}));open();cleanup();finish({history:[]});
  await Promise.resolve();
  let fail;api.get.mockReturnValue(new Promise((_,reject)=>{fail=reject;}));open();cleanup();fail(new Error('Late failure'));await Promise.resolve();
  expect(screen.queryByRole('alert')).toBeNull();
});
