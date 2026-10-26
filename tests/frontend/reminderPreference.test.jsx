// File: Tests the ReminderPreference control (AC4.1–AC4.6): loading, load-failure, empty-default, enabling/disabling,
// cadence selection, save success, save failure, and the persistence round-trip.
// Test scope: the control is rendered with the client wrapper mocked so load/save outcomes are driven deterministically.
// The wrapper's own endpoint/payload contract is covered separately in reminderPreferenceClient.test.js.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the wrapper so the control tests drive load/save outcomes without a real network.
vi.mock('../../frontend/src/api/reminderPreferenceClient', () => ({ reminderPreferenceClient: { get: vi.fn(), save: vi.fn() } }));

import { reminderPreferenceClient } from '../../frontend/src/api/reminderPreferenceClient';
import ReminderPreference from '../../frontend/src/pages/tech-support/ReminderPreference';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ReminderPreference control', () => {
  // Reads the enabled checkbox and the cadence selector once the control is ready.
  const toggle = () => screen.getByRole('checkbox', { name: /periodic reminders/i });
  const cadence = () => screen.getByRole('combobox', { name: /reminder cadence/i });
  const saveButton = () => screen.getByRole('button', { name: /save preference|saving|preference saved/i });

  // AC4.1 happy: the control reflects the stored enabled flag and cadence.
  it('TS AC4.1 - the control reflects the stored enabled flag and cadence', async () => {
    // Arrange: a stored, enabled, daily preference.
    reminderPreferenceClient.get.mockResolvedValue({ enabled: true, frequency: 'daily' });
    // Act
    render(<ReminderPreference token="staff-token" />);
    // Assert: once loaded, the toggle is on and the cadence shows daily.
    await waitFor(() => expect(toggle().checked).toBe(true));
    expect(cadence().value).toBe('daily');
  });

  // AC4.1 error: a failed load shows an alert and hides the controls (no guessed preference presented as current).
  it('TS AC4.1 - a failed preference load shows an alert and hides the controls', async () => {
    reminderPreferenceClient.get.mockRejectedValue(new Error('Preference unavailable.'));
    render(<ReminderPreference token="staff-token" />);
    expect((await screen.findByRole('alert')).textContent).toBe('Preference unavailable.');
    // The toggle and selector must not render while the load failed.
    expect(screen.queryByRole('checkbox', { name: /periodic reminders/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /reminder cadence/i })).toBeNull();
  });

  // AC4.1 boundary: no stored preference shows the default (disabled, weekly) so the control is always usable.
  it('TS AC4.1 - no stored preference shows the default (disabled, weekly)', async () => {
    reminderPreferenceClient.get.mockResolvedValue(null);
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(toggle().checked).toBe(false));
    expect(cadence().value).toBe('weekly');
  });

  // AC4.2 happy: enabling and saving persists { enabled: true, frequency } via the client.
  it('TS AC4.2 - enabling and saving persists { enabled: true, frequency } via the client', async () => {
    reminderPreferenceClient.get.mockResolvedValue({ enabled: false, frequency: 'weekly' });
    reminderPreferenceClient.save.mockResolvedValue({ enabled: true, frequency: 'weekly' });
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(toggle()).toBeTruthy());
    // Act: turn reminders on and save.
    fireEvent.click(toggle());
    fireEvent.click(saveButton());
    // Assert: the saved payload records enabled true with the selected cadence and the token.
    await waitFor(() => expect(reminderPreferenceClient.save).toHaveBeenCalledWith({ enabled: true, frequency: 'weekly' }, 'staff-token'));
  });

  // AC4.2 error: a failed save shows an error and does not claim the preference was saved.
  it('TS AC4.2 - a failed save shows an error and does not claim the preference was saved', async () => {
    reminderPreferenceClient.get.mockResolvedValue({ enabled: false, frequency: 'weekly' });
    reminderPreferenceClient.save.mockRejectedValue(new Error('Could not save preference.'));
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    fireEvent.click(saveButton());
    // Assert: the error is surfaced and the button never reads "Preference saved".
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save preference.');
    expect(screen.queryByRole('button', { name: 'Preference saved' })).toBeNull();
    // The member's edit is retained so they can retry.
    expect(toggle().checked).toBe(true);
  });

  // AC4.3: selecting a cadence persists the chosen value.
  it('TS AC4.3 - selecting daily or weekly persists the chosen cadence', async () => {
    reminderPreferenceClient.get.mockResolvedValue({ enabled: true, frequency: 'weekly' });
    reminderPreferenceClient.save.mockResolvedValue({ enabled: true, frequency: 'daily' });
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(cadence()).toBeTruthy());
    fireEvent.change(cadence(), { target: { value: 'daily' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(reminderPreferenceClient.save).toHaveBeenCalledWith({ enabled: true, frequency: 'daily' }, 'staff-token'));
  });

  // AC4.4: disabling and saving persists { enabled: false }.
  it('TS AC4.4 - disabling and saving persists { enabled: false }', async () => {
    reminderPreferenceClient.get.mockResolvedValue({ enabled: true, frequency: 'weekly' });
    reminderPreferenceClient.save.mockResolvedValue({ enabled: false, frequency: 'weekly' });
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(toggle().checked).toBe(true));
    fireEvent.click(toggle());
    fireEvent.click(saveButton());
    await waitFor(() => expect(reminderPreferenceClient.save).toHaveBeenCalledWith({ enabled: false, frequency: 'weekly' }, 'staff-token'));
  });

  // AC4.5: while disabled the saved preference records disabled (frontend persistence; emission is backend).
  it('TS AC4.5 - while disabled the saved preference records disabled (frontend persistence; emission is backend)', async () => {
    reminderPreferenceClient.get.mockResolvedValue({ enabled: false, frequency: 'weekly' });
    reminderPreferenceClient.save.mockResolvedValue({ enabled: false, frequency: 'weekly' });
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(toggle().checked).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(reminderPreferenceClient.save).toHaveBeenCalledWith({ enabled: false, frequency: 'weekly' }, 'staff-token'));
  });

  // AC4.6: while enabled the saved preference records enabled with the cadence (frontend persistence; emission is backend).
  it('TS AC4.6 - while enabled the saved preference records enabled and the cadence (frontend persistence; emission is backend)', async () => {
    reminderPreferenceClient.get.mockResolvedValue({ enabled: true, frequency: 'daily' });
    reminderPreferenceClient.save.mockResolvedValue({ enabled: true, frequency: 'daily' });
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(toggle().checked).toBe(true));
    fireEvent.click(saveButton());
    await waitFor(() => expect(reminderPreferenceClient.save).toHaveBeenCalledWith({ enabled: true, frequency: 'daily' }, 'staff-token'));
  });

  // AC4.2 feedback: a successful save confirms success to the member.
  it('TS AC4.2 - a successful save confirms the preference was saved', async () => {
    reminderPreferenceClient.get.mockResolvedValue({ enabled: false, frequency: 'weekly' });
    reminderPreferenceClient.save.mockResolvedValue({ enabled: true, frequency: 'weekly' });
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    fireEvent.click(saveButton());
    expect(await screen.findByRole('button', { name: 'Preference saved' })).toBeTruthy();
  });

  // Feature: tech-support-assignment-notifications, Property 5: Reminder preference persistence round-trip.
  // For any representable { enabled, frequency }, loading reflects that value and saving sends exactly it.
  it('TS AC4.3 - Property 5: any representable { enabled, frequency } reloads unchanged and saves exactly', async () => {
    const enabledValues = [true, false];
    const frequencies = ['daily', 'weekly'];
    let checked = 0;
    for (const enabled of enabledValues) {
      for (const frequency of frequencies) {
        // Arrange: a fresh render per representable value (small finite domain, each combination exercised).
        cleanup();
        vi.clearAllMocks();
        reminderPreferenceClient.get.mockResolvedValue({ enabled, frequency });
        reminderPreferenceClient.save.mockResolvedValue({ enabled, frequency });
        render(<ReminderPreference token="staff-token" />);
        // Assert load reflects the persisted value exactly.
        await waitFor(() => expect(toggle().checked).toBe(enabled));
        expect(cadence().value).toBe(frequency);
        // Act: save without edits and assert the exact same payload is sent back.
        fireEvent.click(saveButton());
        await waitFor(() => expect(reminderPreferenceClient.save).toHaveBeenCalledWith({ enabled, frequency }, 'staff-token'));
        checked += 1;
      }
    }
    expect(checked).toBe(4);
  });

  // AC4.1: a load response that resolves after the control unmounts must not attempt a state update (stale guard).
  it("TS AC4.1 - a load resolving after unmount does not update state", async () => {
    // Arrange: a deferred get so we can unmount before it resolves.
    let resolveGet;
    reminderPreferenceClient.get.mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));
    const { unmount } = render(<ReminderPreference token="staff-token" />);
    // Act: unmount first, then let the load resolve.
    unmount();
    await act(async () => { resolveGet({ enabled: true, frequency: "daily" }); });
    // Assert: no error is thrown and nothing from the unmounted tree renders.
    expect(screen.queryByRole("checkbox", { name: /periodic reminders/i })).toBeNull();
  });

  // AC4.1: a load that rejects after the control unmounts must not attempt a state update (stale guard on error).
  it("TS AC4.1 - a load rejecting after unmount does not update state", async () => {
    let rejectGet;
    reminderPreferenceClient.get.mockReturnValue(new Promise((_, reject) => { rejectGet = reject; }));
    const { unmount } = render(<ReminderPreference token="staff-token" />);
    unmount();
    // Act: reject after unmount; the catch must early-return without setting error state.
    await act(async () => { rejectGet(new Error("late failure")); });
    // Assert: no alert from the unmounted tree is present.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // AC4.2: a save error with no message falls back to a clear default message rather than showing blank.
  it("TS AC4.2 - a save error without a message shows a default error", async () => {
    reminderPreferenceClient.get.mockResolvedValue({ enabled: false, frequency: "weekly" });
    // Arrange: reject with an error whose message is empty, exercising the fallback branch.
    reminderPreferenceClient.save.mockRejectedValue(new Error(""));
    render(<ReminderPreference token="staff-token" />);
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Unable to save reminder preference.");
  });
});
