import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useRegistrationResource from '../../frontend/src/pages/registrations/useRegistrationResource';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

/** Resolves initial HTTP microtasks without advancing the polling schedule. */
async function settle() { await act(async () => {}); }

it('Status AC2 - a slow read prevents overlap and polling resumes at the 10000ms boundary', async () => {
  // Arrange: a slow request is an external-boundary fixture, never a mocked state-update implementation.
  let finish;
  api.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useRegistrationResource('/registrations/mine', 'session'));
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
  expect(api.get).toHaveBeenCalledTimes(1);
  await act(async () => finish({ status: 'waitlisted' }));
  api.get.mockResolvedValue({ status: 'registered' });
  await act(async () => { await vi.advanceTimersByTimeAsync(4998); });
  expect(api.get).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(result.current.data.status).toBe('registered');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(api.get).toHaveBeenCalledTimes(2);
});
it('Status AC2 - a change just after a poll is present by 10000ms, with stable results at 10001ms', async () => {
  let status = 'waitlisted'; api.get.mockImplementation(async () => ({ status }));
  const { result } = renderHook(() => useRegistrationResource('/registrations/mine', 'session')); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); }); status = 'registered';
  await act(async () => { await vi.advanceTimersByTimeAsync(4998); });
  expect(result.current.data.status).toBe('waitlisted');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(result.current.data.status).toBe('registered');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(result.current.data.status).toBe('registered');
});
it.each(['resolve', 'reject'])('Status AC2 - an obsolete poll cannot %s over a committed write', async outcome => {
  let finish, fail;
  api.get.mockResolvedValueOnce({ status: 'waitlisted' }).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const { result } = renderHook(() => useRegistrationResource('/registrations/mine', 'session')); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  // Act: a successful write is newer evidence than the in-flight GET snapshot.
  act(() => result.current.updateData({ status: 'registered' }));
  await act(async () => { if (outcome === 'resolve') finish({ status: 'waitlisted' }); else fail(new Error('Old request failed')); });
  expect(result.current.data.status).toBe('registered'); expect(result.current.error).toBe('');
});
it.each(['resolve', 'reject'])('Status AC2 - late %s from a previous path/session cannot overwrite the current attendee', async outcome => {
  let finish, fail;
  api.get.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }))
    .mockResolvedValue({ owner: 'new attendee' });
  const { result, rerender } = renderHook(({ path, token }) => useRegistrationResource(path, token),
    { initialProps: { path: '/registrations/events/1', token: 'old-session' } });
  rerender({ path: '/registrations/events/2', token: 'new-session' }); await settle();
  await act(async () => { if (outcome === 'resolve') finish({ owner: 'previous attendee' }); else fail(new Error('Old session failed')); });
  expect(result.current.data).toEqual({ owner: 'new attendee' }); expect(result.current.error).toBe('');
  expect(api.get).toHaveBeenLastCalledWith('/registrations/events/2', 'new-session');
});
it('Status AC2 - visibility recovery refreshes only when the tab becomes visible', async () => {
  api.get.mockResolvedValue({ status: 'registered' });
  renderHook(() => useRegistrationResource('/registrations/mine', 'session')); await settle();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(api.get).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(api.get).toHaveBeenCalledTimes(2);
});
it.each([401, 403, 404])('Status AC1/AC2 - HTTP %s clears records when access is lost', async status => {
  api.get.mockResolvedValueOnce({ status: 'registered' }).mockRejectedValueOnce(Object.assign(new Error('Access unavailable'), { status }));
  const { result } = renderHook(() => useRegistrationResource('/registrations/mine', 'session')); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(result.current.data).toBe(null); expect(result.current.error).toBe('Access unavailable');
});
