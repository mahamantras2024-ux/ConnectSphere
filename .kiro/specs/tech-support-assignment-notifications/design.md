# Design Document

## Overview

This feature extends the existing frontend notification subsystem so a Technical Support Staff member is informed about the work assigned to them: a new on-site support assignment, an update or cancellation of that assignment, and an equipment status change on a reservation they are responsible for. It also adds a Reminder Preference control to the Technical Support dashboard so a member can opt in to periodic reminders about pending work and choose a daily or weekly cadence.

The work is frontend-focused and reuses the parent notification system rather than rebuilding it. The notification bell, the per-notification preview, the mark-read flow, and the dashboard notifications panel already work for every signed-in role; this feature teaches three of those pieces about four new `Notification_Type` values and adds one new self-contained UI control plus its API client call. The backend controllers and services that emit the underlying domain events already exist and are out of primary scope — the frontend consumes the notifications they produce.

Three existing seams carry the whole change:

- **`notificationTarget.js`** decides which page a notification opens. The four new types resolve to `/tech-support/dashboard`.
- **`notificationPreview.js`** formats the one-line headline. No code change is required to the formatter itself; the headline content comes from the stored `message`/`title`. The design documents the headline contract (names the event, or the item and its new status) that the backend message must satisfy and that the preview surfaces unchanged.
- **The Technical Support dashboard** (`TechSupportDashboard.jsx`) gains a Reminder Preference control that reads and writes `{ enabled, frequency }` through the shared `api` client, following the loading/error/empty-state patterns already used by `OnSiteSupportSection.jsx`.

### Scope and non-goals

- In scope (frontend): routing the four new notification types to the dashboard; confirming previews surface the required headline facts; a Reminder Preference control with persistence; the tests that pin all of this down.
- Out of primary scope (backend, consumed as-is): producing the notifications, selecting the equipment-status recipients, and the scheduler that emits periodic reminders at the chosen cadence. The recipient-selection rule (AC3) and the reminder-emission rules (AC4.5/4.6) are stated as correctness properties for traceability and validated where that logic lives; the frontend consumes their results.

### Technology and conventions

- Language: JavaScript / JSX (React), matching the existing `frontend/src` tree.
- Tests: Vitest + React Testing Library + jsdom, under `tests/frontend`, written test-first (TDD). Test names are AC-tagged, following the house style in `parentNotifications.test.jsx` (e.g. `NT AC4 - ...`) and `technicalSupportAssignment.test.jsx` (e.g. `AC2 - ...`).
- API access: the shared `api` client (`frontend/src/api/client.js`), with the bearer token from `AuthContext`.

## Architecture

### Component and module map

```
frontend/src/
  notifications/
    notificationTarget.js      (modified)  route 4 new types to /tech-support/dashboard
    notificationPreview.js     (unchanged) headline contract documented, formatter reused
    useNotificationOpened.js   (unchanged) dashboard re-reads on open, already wired
  components/
    NotificationBell.jsx       (unchanged) indicates unread for any type, incl. new ones
    NotificationItem.jsx       (unchanged) renders preview + mark-read for any type
  pages/tech-support/
    TechSupportDashboard.jsx   (modified)  mounts the new ReminderPreference control
    ReminderPreference.jsx     (new)       opt-in toggle + cadence selector + persistence
  api/
    reminderPreferenceClient.js (new)      thin wrapper over api.get/api.put for the preference
```

### Data flow: an assignment or equipment notification

```
backend domain event  ──►  notification row (type, title, message, event_id)
        (out of scope)              │
                                    ▼
      NotificationsContext poll ──► NotificationBell / NotificationsPanel
                                    │
                           NotificationItem
                             ├─ previewText(message)  ──► headline (names event, or item + status)
                             └─ on click:
                                  markRead(notification)            (background)
                                  navigate(notificationTarget(n, 'technical_support'))
                                                   │
                                                   ▼
                                       /tech-support/dashboard
                                   (re-reads via useNotificationOpened)
```

The only new branch in this flow is inside `notificationTarget`: the four new type values short-circuit to the dashboard. Everything else — polling, unread counting, preview shortening, background mark-read, re-reading the opened page — is inherited unchanged from the parent system.

### Data flow: the Reminder Preference control

```
TechSupportDashboard mounts ReminderPreference(token)
        │
        ▼
reminderPreferenceClient.get(token)  ──►  GET /tech-support/reminder-preference
        │                                         │
   loading ─► ready { enabled, frequency }  ◄─────┘   (or default when none stored)
        │
   user toggles enabled / selects daily|weekly, then Save
        │
        ▼
reminderPreferenceClient.save({ enabled, frequency }, token)  ──►  PUT /tech-support/reminder-preference
        │
   saving ─► saved | error
```

The control mirrors the `OnSiteSupportSection` state machine: a single `state` value drives `loading` / `error` / `ready`, with a parallel `saving`/save-error path for the write, and a sensible default when the member has no stored preference yet (empty state).

## Components and Interfaces

### 1. `notificationTarget(notification, role)` — modified

The resolver gains the four new type values. They route to the Technical Support dashboard regardless of the signed-in role mapping, because these notifications are only ever delivered to Technical Support Staff and always concern dashboard-owned work.

```js
// notificationTarget.js
const TECH_SUPPORT_TYPES = new Set([
  'tech_support_assignment_created',
  'tech_support_assignment_updated',
  'tech_support_assignment_cancelled',
  'equipment_status_changed',
]);

export function notificationTarget(notification, role) {
  if (notification.type === 'event_awaiting_assignment') return '/coordinator-lead/dashboard';
  if (TECH_SUPPORT_TYPES.has(notification.type)) return '/tech-support/dashboard';
  if (role === 'safety_officer') {
    return notification.event_id != null
      ? `/safety/dashboard#${SAFETY_EVENT_ANCHOR(notification.event_id)}`
      : '/safety/dashboard';
  }
  const eventPage = EVENT_PAGES[role];
  return notification.event_id != null && eventPage ? eventPage(notification.event_id) : getDashboardRoute(role);
}
```

The type check is placed before the role branches so routing is driven by the notification's meaning (dashboard-owned tech-support work) rather than the viewer's role, and it is independent of whether `event_id` is present.

### 2. Notification headline contract — `notificationPreview.js` (unchanged formatter)

`previewText` already returns the first non-empty line, shortened to `PREVIEW_LIMIT` at a word boundary with an ellipsis. No formatter change is needed. The design fixes the *contract* for the stored `message` so the headline satisfies the acceptance criteria:

- Assignment notifications (`tech_support_assignment_created` / `_updated` / `_cancelled`): the first line names the event, e.g. `On-site support assigned: {eventName}`.
- Equipment notifications (`equipment_status_changed`): the first line names the affected item and its new status, e.g. `Equipment {itemName} is now {humanStatus}` where `humanStatus` renders `damaged` → "damaged" and `under_maintenance` → "under maintenance".

Because the frontend consumes backend-authored messages, the frontend tests assert that `previewText` surfaces these facts as a single headline within the limit for any event name / item name / status, treating the backend message format as the input. A small shared helper formats the human-readable status so the test and any frontend rendering agree:

```js
// humanStatus maps a stored Equipment_Status to the words shown to a member.
export function humanEquipmentStatus(status) {
  return String(status || '').replace(/_/g, ' ');
}
```

### 3. `ReminderPreference` component — new

A self-contained control mounted on the Technical Support dashboard. It owns its own load/save lifecycle and does not disturb the dashboard's existing equipment queues.

Props:

```
ReminderPreference({ token })
```

Behavior:

- On mount, loads the stored preference. While loading it shows a `role="status"` message; on failure it shows a `role="alert"` message; on success it shows the toggle and cadence selector reflecting the stored `{ enabled, frequency }`.
- When no preference is stored yet, it shows a sensible default (disabled, `weekly`) as the empty state so the control is always usable.
- The enabled toggle is a checkbox labelled "Periodic reminders". The cadence is a selector offering `daily` and `weekly`. The cadence selector is available so a member can choose the cadence they want to save, consistent with AC3.
- Save sends the current `{ enabled, frequency }` through the client. While saving the button is disabled and labelled accordingly; a failed save shows an error and does not claim success (matching the `OnSiteSupportSection` / `TechnicalSupportAssignment` error pattern).

Sketch:

```jsx
// ReminderPreference.jsx
import { useEffect, useState } from 'react';
import { reminderPreferenceClient } from '../../api/reminderPreferenceClient';

const CADENCES = [['daily', 'Daily'], ['weekly', 'Weekly']];

export default function ReminderPreference({ token }) {
  const [state, setState] = useState('loading');     // loading | ready | error
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    reminderPreferenceClient.get(token).then((pref) => {
      if (!active) return;
      setEnabled(Boolean(pref?.enabled));
      setFrequency(pref?.frequency === 'daily' ? 'daily' : 'weekly');
      setState('ready');
    }).catch((err) => { if (active) { setError(err.message); setState('error'); } });
    return () => { active = false; };
  }, [token]);

  async function save() {
    setSaving(true); setSaveError(''); setSaved(false);
    try {
      await reminderPreferenceClient.save({ enabled, frequency }, token);
      setSaved(true);
    } catch (err) {
      setSaveError(err.message || 'Unable to save reminder preference.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="reminder-preference" aria-labelledby="reminder-preference-title">
      <h2 id="reminder-preference-title">Periodic reminders</h2>
      {state === 'loading' && <p role="status">Loading reminder preference…</p>}
      {state === 'error' && <p role="alert" className="error-message">{error}</p>}
      {state === 'ready' && (
        <div className="reminder-preference-controls">
          <label>
            <input type="checkbox" checked={enabled}
              onChange={(e) => { setSaved(false); setEnabled(e.target.checked); }} />
            Periodic reminders
          </label>
          <label>
            Cadence
            <select aria-label="Reminder cadence" value={frequency}
              onChange={(e) => { setSaved(false); setFrequency(e.target.value); }}>
              {CADENCES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          {saveError && <p role="alert" className="error-message">{saveError}</p>}
          <button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Preference saved' : 'Save preference'}
          </button>
        </div>
      )}
    </section>
  );
}
```

### 4. `reminderPreferenceClient` — new API wrapper

A thin wrapper over the shared `api` client so the component depends on an intention-revealing surface and the tests can mock one module.

```js
// reminderPreferenceClient.js
import { api } from './client';

export const reminderPreferenceClient = {
  // Returns the stored { enabled, frequency } or null when none exists.
  get: (token) => api.get('/tech-support/reminder-preference', token),
  // Persists { enabled, frequency } for the signed-in member.
  save: (preference, token) => api.put('/tech-support/reminder-preference', preference, token),
};
```

### 5. `TechSupportDashboard.jsx` — modified

Mounts `<ReminderPreference token={token} />` alongside the existing sections (near `OnSiteSupportSection`), passing the token already read from `useAuth`. No other dashboard behavior changes.

## Data Models

### Notification (existing shape, consumed as-is)

```
{
  id: number,
  event_id: number | null,
  type: 'tech_support_assignment_created'
      | 'tech_support_assignment_updated'
      | 'tech_support_assignment_cancelled'
      | 'equipment_status_changed'
      | <existing types…>,
  title: string,       // short title shown in the preview header
  message: string,     // first line is the headline; later lines are full-record detail
  created_at: string,  // ISO timestamp
  read_at: string | null
}
```

### Reminder preference

```
ReminderPreference {
  enabled: boolean,
  frequency: 'daily' | 'weekly'
}
```

- `GET /tech-support/reminder-preference` → `ReminderPreference | null` (null ⇒ default: `{ enabled: false, frequency: 'weekly' }`).
- `PUT /tech-support/reminder-preference` with body `{ enabled, frequency }` → the stored `ReminderPreference`.

## Error Handling

- **Notification routing**: pure and total — every notification resolves to some path. Unknown or missing `event_id` on a new tech-support type still resolves to `/tech-support/dashboard`, so a malformed row never strands the member.
- **Preference load failure**: the control shows a `role="alert"` message and hides the toggle/selector, mirroring `OnSiteSupportSection`'s error state, so no stale or guessed preference is presented as current.
- **Preference save failure**: the control surfaces the error, keeps the member's edits in place, and does not show "Preference saved" — the same "don't claim success on failure" rule as `TechnicalSupportAssignment` (AC3).
- **Stale responses**: the load effect uses an `active` guard (as in `AuthContext` and `OnSiteSupportSection`) so a late response after token change or unmount cannot update the control.
- **Empty preference**: a missing stored preference is treated as the default rather than an error, so the control is always actionable.
- **Mark-read on open**: inherited from `NotificationItem` — marking read runs in the background and a slow/stalled/failed request never blocks navigation to the dashboard.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: New tech-support notification types open the dashboard

*For any* notification whose type is one of `tech_support_assignment_created`, `tech_support_assignment_updated`, `tech_support_assignment_cancelled`, or `equipment_status_changed`, and for any `event_id` (present or null), `notificationTarget` resolves the in-app path to `/tech-support/dashboard`.

**Validates: Requirements 1.3, 2.4, 3.3**

### Property 2: Assignment preview headline names the event

*For any* assignment notification (type `tech_support_assignment_created`, `tech_support_assignment_updated`, or `tech_support_assignment_cancelled`) whose message names the event on its first line, `previewText(message)` returns a single-line headline that contains the event name and whose length does not exceed `PREVIEW_LIMIT`.

**Validates: Requirements 1.2, 2.3**

### Property 3: Equipment preview headline names the item and new status

*For any* `equipment_status_changed` notification whose message names the affected item and its new status (`damaged` or `under_maintenance`) on its first line, `previewText(message)` returns a single-line headline that contains both the item name and the human-readable status, within `PREVIEW_LIMIT`.

**Validates: Requirements 3.2**

### Property 4: Equipment-status notifications reach exactly the assigned on-site staff

*For any* equipment status change to `damaged` or `under_maintenance` on an Equipment_Reservation, the set of Tech_Support_Staff members who receive the `equipment_status_changed` notification equals exactly the set of members holding an On_Site_Support_Assignment for the event that the affected reservation reserved — so assigned members are notified and members with no such assignment are not.

**Validates: Requirements 3.1, 3.4**

*Note: the recipient-selection logic is backend domain behavior, out of frontend primary scope. This property is stated for traceability and validated where the selection logic lives; the frontend example-tests that a received `equipment_status_changed` notification renders.*

### Property 5: Reminder preference persistence round-trip

*For any* preference value `{ enabled, frequency }` the control can represent (`enabled` either boolean, `frequency` either `daily` or `weekly`), saving sends exactly that `{ enabled, frequency }` payload through the API client, and loading the control from that persisted value reflects the same `enabled` flag and the same `frequency`.

**Validates: Requirements 4.2, 4.3, 4.4**

*Note: the reminder-emission behavior (AC4.5 omit while disabled; AC4.6 emit at the cadence while enabled) is backend scheduler responsibility, out of frontend primary scope. The frontend's obligation is to persist the preference faithfully, which this round-trip property covers.*

## Testing Strategy

### Approach

Test-first (TDD) with Vitest + React Testing Library + jsdom. New tests live under `tests/frontend`. Pure rules (`notificationTarget`, `previewText`) are property-tested with generated inputs; component behavior (the Reminder Preference control, the bell showing a new type) is example/edge tested at the component level, mocking the `api` client / `reminderPreferenceClient` as the existing suites do. Property tests run at least 100 iterations and are tagged `Feature: tech-support-assignment-notifications, Property {n}: {property text}`.

House-style references:
- `tests/frontend/parentNotifications.test.jsx` — `NT AC#` names, `notificationTarget`/`previewText` tables, bell/unread assertions, mocked `api` client.
- `tests/frontend/technicalSupportAssignment.test.jsx` — `AC#` names, `OnSiteSupportSection` loading/error/empty patterns, "don't claim success on failure" assertions.

Suggested files:
- `tests/frontend/techSupportNotificationRouting.test.jsx` — Properties 1–3 and the type presentation examples (AC1.x, 2.x, 3.1–3.3).
- `tests/frontend/reminderPreference.test.jsx` — Property 5 and the control's state examples (AC4.1–4.4).

### Test matrix

Each AC maps to concrete scenarios covering happy path, error, and boundary, with AC-tagged names.

| AC | Scenario (happy) | Scenario (error) | Scenario (boundary) | Kind |
|----|------------------|------------------|---------------------|------|
| 1.1 | `TS AC1.1 - a created-assignment notification appears in the bell for tech support` | — | — | EXAMPLE |
| 1.2 | `TS AC1.2 - a created-assignment headline names the event` | — | `TS AC1.2 - a long event name is kept whole on the headline within the preview limit` | PROPERTY (P2) |
| 1.3 | `TS AC1.3 - opening a created-assignment notification opens the tech support dashboard` | — | `TS AC1.3 - a created-assignment notification with no event id still opens the dashboard` | PROPERTY (P1) |
| 1.4 | `TS AC1.4 - an unread created-assignment notification shows the bell unread count` | — | — | EXAMPLE |
| 2.1 | `TS AC2.1 - an updated-assignment notification appears in the bell` | — | — | EXAMPLE |
| 2.2 | `TS AC2.2 - a cancelled-assignment notification appears in the bell` | — | — | EXAMPLE |
| 2.3 | `TS AC2.3 - updated and cancelled headlines name the event` | — | `TS AC2.3 - a headline longer than the limit is shortened with an ellipsis` | PROPERTY (P2) |
| 2.4 | `TS AC2.4 - opening an updated or cancelled notification opens the dashboard` | — | `TS AC2.4 - an updated or cancelled notification with no event id still opens the dashboard` | PROPERTY (P1) |
| 3.1 | `TS AC3.1 - a received equipment-status notification appears for an assigned member` | — | — | EXAMPLE (+ P4 recipient rule validated backend-side) |
| 3.2 | `TS AC3.2 - an equipment-status headline names the item and its new status` | — | `TS AC3.2 - both "damaged" and "under maintenance" render as words in the headline` | PROPERTY (P3) |
| 3.3 | `TS AC3.3 - opening an equipment-status notification opens the dashboard` | — | `TS AC3.3 - an equipment-status notification with no event id still opens the dashboard` | PROPERTY (P1) |
| 3.4 | — | — | `TS AC3.4 - recipients equal exactly the on-site-assigned staff for the reserving event` | PROPERTY (P4, traceability) |
| 4.1 | `TS AC4.1 - the dashboard shows the reminder control reflecting the stored enabled flag and cadence` | `TS AC4.1 - a failed preference load shows an alert and hides the controls` | `TS AC4.1 - no stored preference shows the default (disabled, weekly)` | EXAMPLE / EDGE |
| 4.2 | `TS AC4.2 - enabling and saving persists { enabled: true, frequency } via the client` | `TS AC4.2 - a failed save shows an error and does not claim the preference was saved` | — | PROPERTY (P5) |
| 4.3 | `TS AC4.3 - selecting daily or weekly persists the chosen cadence` | — | `TS AC4.3 - round-trip: any representable { enabled, frequency } reloads unchanged` | PROPERTY (P5) |
| 4.4 | `TS AC4.4 - disabling and saving persists { enabled: false }` | — | — | PROPERTY (P5) |
| 4.5 | — | — | `TS AC4.5 - while disabled the saved preference records disabled (frontend persistence; emission is backend)` | PROPERTY (P5) / INTEGRATION (backend) |
| 4.6 | — | — | `TS AC4.6 - while enabled the saved preference records enabled and the cadence (frontend persistence; emission is backend)` | PROPERTY (P5) / INTEGRATION (backend) |

### Unit vs property balance

- **Property tests** cover the input-varying rules: routing over all four new types and any `event_id` (P1), the assignment headline naming the event across generated event names/lengths (P2), the equipment headline naming item + status across generated names and both status values (P3), and the preference persistence round-trip across representable `{ enabled, frequency }` values (P5).
- **Example / edge tests** cover fixed presentations and states: each new type appearing in the bell with its unread indicator (AC1.1, 1.4, 2.1, 2.2, 3.1), and the Reminder Preference control's loading, error, empty-default, and save-failure states (AC4.1).
- **Out-of-scope here**: the equipment-status recipient selection (P4) and reminder emission/scheduling (AC4.5/4.6) are backend responsibilities; the frontend only consumes notifications and persists the preference.

### Five Review Criteria

All new tests and components are written to satisfy the Five Review Criteria:

1. **Behavioral coverage** — every testable AC has at least one scenario; input-varying ACs get property tests, fixed ACs get examples; happy, error, and boundary columns are populated per AC above.
2. **Clear naming** — AC-tagged, behavior-describing test names (`TS AC#.# - <behavior>`), matching the `NT AC#` / `AC#` house style.
3. **Isolation and determinism** — the `api` client / `reminderPreferenceClient` is mocked; `active`-guarded effects prevent stale updates; no real network or timers beyond the parent system's fake-timer patterns.
4. **Honest failure reporting** — save/load failures are asserted to surface an alert and to not claim success, so a green test cannot hide a broken persistence path.
5. **Maintainability** — one thin client wrapper and one self-contained control; routing changes are a single guarded branch in `notificationTarget`; the preview formatter is reused unchanged with a documented headline contract.
