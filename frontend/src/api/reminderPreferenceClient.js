// File: Thin, intention-revealing wrapper over the shared api client for a tech-support member's periodic reminder
// preference (AC4). Keeping the endpoint in one place lets the control depend on get/save and lets tests mock a single
// module rather than the whole api client.
import { api } from './client';

// The single endpoint that stores and returns a member's { enabled, frequency } reminder preference.
const ENDPOINT = '/tech-support/reminder-preference';

export const reminderPreferenceClient = {
  // Returns the stored { enabled, frequency }, or null when the member has no preference yet (the control then defaults).
  get: (token) => api.get(ENDPOINT, token),
  // Persists exactly the { enabled, frequency } the member chose, for the signed-in member.
  save: (preference, token) => api.put(ENDPOINT, preference, token),
};
