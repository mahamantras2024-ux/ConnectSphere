// File: Tests the reminder preference API wrapper (AC4.2/4.3/4.4): it calls the correct endpoint with the member's
// token and returns the api client's result. Kept separate so it can use the REAL wrapper against a mocked api client,
// without the component-level mock of the wrapper used by reminderPreference.test.jsx.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

import { api } from '../../frontend/src/api/client';
import { reminderPreferenceClient } from '../../frontend/src/api/reminderPreferenceClient';

const ENDPOINT = '/tech-support/reminder-preference';
afterEach(() => { vi.clearAllMocks(); });

describe('reminderPreferenceClient', () => {
  // AC4.2/4.3/4.4: get reads exactly the preference endpoint with the token and returns the api result unchanged.
  it('TS AC4.2 - get reads the reminder-preference endpoint with the token and returns the result', async () => {
    // Arrange
    const stored = { enabled: true, frequency: 'daily' };
    api.get.mockResolvedValue(stored);
    // Act
    const result = await reminderPreferenceClient.get('staff-token');
    // Assert: a wrong endpoint or missing token would fail here; the result is returned verbatim.
    expect(api.get).toHaveBeenCalledWith(ENDPOINT, 'staff-token');
    expect(result).toEqual(stored);
  });

  // AC4.2/4.3/4.4: save PUTs exactly the { enabled, frequency } payload with the token.
  it('TS AC4.2 - save writes the exact { enabled, frequency } payload with the token', async () => {
    api.put.mockResolvedValue({ enabled: false, frequency: 'weekly' });
    await reminderPreferenceClient.save({ enabled: false, frequency: 'weekly' }, 'staff-token');
    // A faulty impl that dropped the frequency or used POST would fail this exact-call assertion.
    expect(api.put).toHaveBeenCalledWith(ENDPOINT, { enabled: false, frequency: 'weekly' }, 'staff-token');
  });
});
