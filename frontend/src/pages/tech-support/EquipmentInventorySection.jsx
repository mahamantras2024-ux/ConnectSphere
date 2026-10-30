// File: Displays the fixed asset catalogue and a separate calendar for searched equipment.
import { useState } from 'react';

const formatDate = value => new Intl.DateTimeFormat('en-SG', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const getMonthLabel = value => new Intl.DateTimeFormat('en-SG', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const CALENDAR_HORIZON_DAYS = 90;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Calendar styles live with the component. Colours are tokens on .equipment-calendar-section so they can be
// matched to the neutral Technical Support page; the dark values retain the remote calendar's colour-scheme support.
const CALENDAR_STYLES = `
.equipment-calendar-section {
  --cal-border: #dfe5e0;
  --cal-surface: #f6f8f6;
  --cal-muted-surface: #edf1ee;
  --cal-text: #30391c;
  --cal-text-muted: #686a5e;
  --cal-available: #1a7f4b;
  --cal-available-bg: #e6f5ec;
  --cal-unavailable: #c62828;
  --cal-unavailable-bg: #fdeaea;
  --cal-focus: #424f19;
  margin-top: 2rem;
  color: var(--cal-text);
}
@media (prefers-color-scheme: dark) {
  .equipment-calendar-section {
    --cal-border: #33364d;
    --cal-surface: #181a2b;
    --cal-muted-surface: #121422;
    --cal-text: #e8e9f6;
    --cal-text-muted: #9a9dbb;
    --cal-available: #6fd3a0;
    --cal-available-bg: #16352a;
    --cal-unavailable: #ff8a80;
    --cal-unavailable-bg: #3d1f1d;
    --cal-focus: #9ea2ff;
  }
}
.equipment-calendar-navigation {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin: 0 0 1rem;
}
.equipment-calendar-navigation > span {
  min-width: 10rem;
  text-align: center;
  font-size: 1.05rem;
  font-weight: 600;
}
.equipment-calendar-navigation button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
}
.equipment-calendar-navigation button:focus-visible {
  outline: 2px solid var(--cal-focus);
  outline-offset: 2px;
}
.equipment-calendar-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem 1.25rem;
  margin: 0 0 1.25rem;
  padding: 0;
  list-style: none;
  font-size: 0.8125rem;
  color: var(--cal-text-muted);
}
.equipment-calendar-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.equipment-calendar-legend li::before {
  content: "";
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: var(--swatch-bg);
  border: 1px solid var(--swatch);
}
.equipment-calendar-legend .is-available   { --swatch: var(--cal-available);   --swatch-bg: var(--cal-available-bg); }
.equipment-calendar-legend .is-unavailable { --swatch: var(--cal-unavailable); --swatch-bg: var(--cal-unavailable-bg); }
.equipment-calendar-assets {
  display: grid;
  gap: 2rem;
}
.equipment-calendar-asset h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 600;
}
.equipment-calendar-scroll {
  overflow-x: auto;
  border: 1px solid var(--cal-border);
  border-radius: 8px;
  background: var(--cal-surface);
}
.equipment-availability-calendar {
  width: 100%;
  min-width: 40rem;
  table-layout: fixed;
  border-collapse: collapse;
}
.equipment-availability-calendar thead th {
  padding: 0.5rem 0.25rem;
  background: var(--cal-muted-surface);
  border-bottom: 1px solid var(--cal-border);
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: center;
  color: var(--cal-text-muted);
}
.equipment-calendar-day {
  position: relative;
  height: 5rem;
  padding: 0.375rem 0.5rem 0.5rem;
  vertical-align: top;
  border: 1px solid var(--cal-border);
  border-width: 0 1px 1px 0;
  font-size: 0.75rem;
  line-height: 1.3;
  overflow: hidden;
}
.equipment-calendar-day:last-child { border-right: 0; }
.equipment-availability-calendar tbody tr:last-child > .equipment-calendar-day { border-bottom: 0; }
.equipment-calendar-day.is-outside-range { background: var(--cal-muted-surface); }
.equipment-calendar-day.is-available     { background: var(--cal-surface); }
.equipment-calendar-day.is-unavailable { background: var(--cal-surface); }
.equipment-calendar-day.is-filtered-date {
  outline: 2px solid var(--cal-focus);
  outline-offset: -2px;
}
.equipment-calendar-day-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  margin-bottom: 0.25rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 600;
}
.equipment-calendar-day > .equipment-calendar-status {
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 600;
}
.equipment-calendar-status.is-available   { color: var(--cal-available); }
.equipment-calendar-status.is-unavailable { color: var(--cal-unavailable); }
.equipment-calendar-blocked-reason {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 0.125rem;
  color: var(--cal-text-muted);
}
.equipment-calendar-windows {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.equipment-calendar-window {
  display: grid;
  gap: 0.0625rem;
  min-width: 0;
  padding: 0.25rem 0.375rem;
  border: 0;
  border-radius: 4px;
  background: var(--window-bg);
}
.equipment-calendar-window.is-available   { --window-color: var(--cal-available);   --window-bg: transparent; }
.equipment-calendar-window.is-unavailable { --window-color: var(--cal-unavailable); --window-bg: transparent; }
.equipment-calendar-time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.equipment-calendar-window .equipment-calendar-status {
  font-size: 0.75rem;
  font-weight: 600;
}
.equipment-calendar-window small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cal-text-muted);
  font-size: 0.75rem;
}
@media (max-width: 640px) {
  .equipment-availability-calendar { min-width: 0; }
  .equipment-availability-calendar thead { display: none; }
  .equipment-availability-calendar,
  .equipment-availability-calendar tbody,
  .equipment-availability-calendar tr,
  .equipment-availability-calendar td { display: block; width: 100%; }
  .equipment-calendar-day { height: auto; border-width: 0 0 1px; }
  .equipment-calendar-day.is-outside-range { display: none; }
  .equipment-calendar-day::before {
    content: attr(data-weekday);
    margin-right: 0.5rem;
    color: var(--cal-text-muted);
    font-weight: 600;
  }
}

/* Overrides: scoped one level deeper so the app's global th/td/li/button rules cannot leak in. */
.equipment-calendar-section .equipment-availability-calendar thead th {
  color: var(--cal-text-muted);
  text-align: center;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
.equipment-calendar-section .equipment-availability-calendar td {
  text-align: center;
  vertical-align: top;
}
.equipment-calendar-section .equipment-calendar-day.is-outside-range {
  background: transparent;
  border-color: transparent;
}
.equipment-calendar-section .equipment-calendar-windows,
.equipment-calendar-section .equipment-calendar-windows li {
  list-style: none;
  margin: 0;
}
.equipment-calendar-section .equipment-calendar-window small {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
  overflow: hidden;
}
.equipment-calendar-section .equipment-calendar-windows li::before,
.equipment-calendar-section .equipment-calendar-windows li::after {
  content: none;
  display: none;
}
.equipment-calendar-section .equipment-calendar-window {
  position: static;
  gap: 0.0625rem;
  /* Match quiet-day status height; reservation wrappers must not add vertical inset. */
  padding: 0 0.5rem;
  border: 0;
  justify-items: center;
  text-align: center;
}
.equipment-calendar-section .equipment-calendar-window .equipment-calendar-status {
  color: var(--cal-text-muted);
  font-weight: 400;
}
.equipment-calendar-section .equipment-calendar-day-number {
  display: flex;
  justify-content: center;
  width: fit-content;
  margin-inline: auto;
  font-size: 18px;
  background: none;
  color: var(--cal-text);
  font-weight: 500;
}
/* Quiet days: a plain stock count in muted text, so only exceptions draw the eye. */
.equipment-calendar-section .equipment-calendar-day > .equipment-calendar-status.is-available {
  color: var(--cal-text-muted);
  font-weight: 400;
}
.equipment-calendar-section .equipment-calendar-navigation button {
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--cal-border);
  border-radius: 8px;
  background: var(--cal-surface);
  box-shadow: none;
  color: var(--cal-text);
}
.equipment-calendar-section .equipment-calendar-navigation button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
`;

function calendarDateAtOffset(offset) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// Keeps weekday alignment while omitting whole weeks outside the visible reservation horizon.
function getMonthGridDates(monthDate, firstVisibleDate, lastVisibleDate) {
  const firstOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
  const lastOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0));
  const visibleStart = new Date(Math.max(firstOfMonth.getTime(), new Date(`${firstVisibleDate}T00:00:00Z`).getTime()));
  const visibleEnd = new Date(Math.min(lastOfMonth.getTime(), new Date(`${lastVisibleDate}T00:00:00Z`).getTime()));
  if (visibleStart > visibleEnd) return [];

  const gridStart = new Date(visibleStart);
  gridStart.setUTCDate(visibleStart.getUTCDate() - visibleStart.getUTCDay());
  const gridEnd = new Date(visibleEnd);
  gridEnd.setUTCDate(visibleEnd.getUTCDate() + (6 - visibleEnd.getUTCDay()));
  return Array.from({ length: (gridEnd.getTime() - gridStart.getTime()) / 86400000 + 1 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const dateString = date.toISOString().slice(0, 10);
    return dateString < firstVisibleDate || dateString > lastVisibleDate ? null : dateString;
  });
}

// Full ranges select overlapping segments; continuous schedule coverage is checked across them below.
function matchesFilters(window, date, fromTime, toTime) {
  if (date && window.date !== date) return false;
  if (fromTime && toTime) {
    // Half-open intervals exclude stock changes exactly at the requested end.
    return window.startTime.slice(0, 5) < toTime && window.endTime.slice(0, 5) > fromTime;
  }
  if (fromTime && window.startTime.slice(0, 5) > fromTime) return false;
  if (toTime && window.endTime.slice(0, 5) < toTime) return false;
  if (fromTime && !toTime && window.endTime.slice(0, 5) <= fromTime) return false;
  if (toTime && !fromTime && window.startTime.slice(0, 5) >= toTime) return false;
  return true;
}

const getAvailabilityWindows = item => Array.isArray(item.availabilities) ? item.availabilities : [];
/**
 * Selects matching stock segments only when their scheduled pieces continuously
 * cover the requested interval on one date. Synthetic reservation windows reduce
 * stock but cannot fill a real schedule gap; unscheduled dates stay bookable.
 */
function getMatchingWindows(item, date, fromTime, toTime) {
  const windows = getAvailabilityWindows(item);
  const matching = windows.filter(window => matchesFilters(window, date, fromTime, toTime));
  if (!fromTime || !toTime) return matching;
  if (fromTime >= toTime) return [];
  const dates = [...new Set(matching.map(window => window.date))];
  return dates.flatMap(day => {
    const dayWindows = matching.filter(window => window.date === day);
    const hasSchedule = windows.some(window => window.date === day && window.isScheduled !== false);
    if (hasSchedule) {
      const scheduled = dayWindows.filter(window => window.isScheduled !== false)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      let coveredUntil = fromTime;
      for (const window of scheduled) {
        if (window.startTime.slice(0, 5) > coveredUntil) return [];
        // Nested/overlapping segments must never move the coverage cursor backwards.
        if (window.endTime.slice(0, 5) > coveredUntil) coveredUntil = window.endTime.slice(0, 5);
      }
      if (coveredUntil < toTime) return [];
    }
    // Dated searches retain exhausted stock as zero; time-only searches advertise usable ranges.
    if (!date && dayWindows.some(window => (Number(window.availableQuantity) || 0) <= 0)) return [];
    return dayWindows;
  });
}

// Legacy stock health values map onto explicit availability until a record is transitioned by staff.
const getAvailabilityStatus = item => item.availability_status ||
  (item.status && item.status !== 'operational' ? 'Unavailable' : 'Available');
const isEquipmentAvailable = item => getAvailabilityStatus(item) === 'Available' &&
  (!item.status || item.status === 'operational');
const formatHistoryDate = value => value
  ? new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value))
  : 'Date unavailable';

const isBlockedWindow = (item, window) => !isEquipmentAvailable(item) ||
  /unavailable|maintenance|damage|blocked/i.test(String(window.status));

function getBlockedReason(item, window) {
  if (window.blockReason) return window.blockReason;
  const latestStatus = item.status_history?.at(-1);
  if (latestStatus?.status === 'Unavailable' && latestStatus.note) return latestStatus.note;
  return window.status === 'Available' ? 'Equipment is unavailable.' : window.status;
}

// The green/red split keeps the calendar scannable; reservation counts remain details, not a third visual state.
function getWindowState(item, window) {
  if (isBlockedWindow(item, window)) return 'unavailable';
  const available = Number(window.availableQuantity) || 0;
  const reserved = Number(window.reservedQuantity) || 0;
  const hasReservation = reserved > 0 || /reserv|book|hold/i.test(String(window.status)) || Boolean(window.eventName);
  if (available > 0) return 'available';
  if (hasReservation) return 'unavailable';
  return window.availableQuantity == null && String(window.status || '').toLowerCase() === 'available'
    ? 'available'
    : 'unavailable';
}

/** Shows fully booked windows as unavailable while preserving partial quantities and specific maintenance/damage reasons. */
function getWindowDetails(item, window, state) {
  const available = Number(window.availableQuantity) || 0;
  const reserved = Number(window.reservedQuantity) || 0;
  const hasReservation = reserved > 0 || /reserv|book|hold/i.test(String(window.status)) || Boolean(window.eventName);
  if (isBlockedWindow(item, window)) {
    if (reserved > 0) return `${getBlockedReason(item, window)} · ${reserved} reserved · ${available} available`;
    return getBlockedReason(item, window);
  }
  if (hasReservation) return state === 'unavailable' ? 'Unavailable' : `${reserved} reserved · ${available} available`;
  if (state === 'unavailable') return getBlockedReason(item, window);
  // Legacy windows without quantities retain their explicit availability instead of inventing a zero count.
  return window.availableQuantity == null ? 'Available' : `${available} available`;
}

/**
 * Filters inventory and shows availability windows; dates without a schedule use full stock unless the asset is blocked.
 * Scheduled segments must continuously cover the requested range; reservation-only windows reduce stock on overlap. Status
 * callbacks persist audited availability transitions and return the updated inventory row through the dashboard.
 */
export default function EquipmentInventorySection({
  inventory,
  error,
  onRepairEquipment,
  onMarkUnavailable,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [calendarEquipmentId, setCalendarEquipmentId] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [calendarMonth, setCalendarMonth] = useState(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const [repairingEquipmentId, setRepairingEquipmentId] = useState(null);
  const [unavailableEquipmentId, setUnavailableEquipmentId] = useState(null);
  const [unavailabilityReason, setUnavailabilityReason] = useState('');
  const [unavailabilityError, setUnavailabilityError] = useState('');
  const [unavailabilitySaving, setUnavailabilitySaving] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [repairError, setRepairError] = useState('');
  const [repairSaving, setRepairSaving] = useState(false);
  const hasAvailabilityFilter = Boolean(dateFilter || fromTime || toTime);
  const hasFilter = Boolean(searchTerm.trim() || hasAvailabilityFilter);
  const invalidTimeRange = Boolean(fromTime && toTime && fromTime >= toTime);
  const search = searchTerm.trim().toLocaleLowerCase();
  const searchCalendarMatches = search
    ? inventory.filter(item => (
      `${item.asset_code} ${item.name}`.toLocaleLowerCase().includes(search)
    ))
    : inventory.filter(item => String(item.id) === calendarEquipmentId);
  const searchCalendarAssets = searchCalendarMatches.map(item => ({
    ...item,
    matchingWindows: getMatchingWindows(item, dateFilter, fromTime, toTime).filter(window => (
      window.date >= calendarDateAtOffset(0) &&
      window.date < calendarDateAtOffset(CALENDAR_HORIZON_DAYS)
    )),
  }));
  // Keep a single readable grid; a narrower search falls back to its first match without retaining unrelated stock.
  const calendarEquipment = searchCalendarAssets.find(item => String(item.id) === calendarEquipmentId) || searchCalendarAssets[0];
  // Selecting a date should reveal the month that contains it, even when it lies outside the month the staff member
  // last paged to. Paging (no date filter) still follows the calendarMonth state so Previous/Next keep working, and a
  // date outside the rolling horizon leaves the paged month untouched rather than scrolling to an unreachable month.
  const firstVisibleDate = calendarDateAtOffset(0);
  const lastVisibleDate = calendarDateAtOffset(CALENDAR_HORIZON_DAYS - 1);
  const dateFilterInHorizon = Boolean(dateFilter) && dateFilter >= firstVisibleDate && dateFilter <= lastVisibleDate;
  const displayedMonth = dateFilterInHorizon
    ? new Date(Date.UTC(Number(dateFilter.slice(0, 4)), Number(dateFilter.slice(5, 7)) - 1, 1))
    : calendarMonth;
  const calendarGridDates = getMonthGridDates(displayedMonth, firstVisibleDate, lastVisibleDate);
  const earliestMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const canMoveToPreviousMonth = displayedMonth.getTime() > earliestMonth.getTime();
  const nextMonthStart = new Date(Date.UTC(displayedMonth.getUTCFullYear(), displayedMonth.getUTCMonth() + 1, 1));
  const latestVisibleDate = new Date(today);
  latestVisibleDate.setUTCDate(today.getUTCDate() + CALENDAR_HORIZON_DAYS);
  const canMoveToNextMonth = nextMonthStart.getTime() < latestVisibleDate.getTime();

  const assetsToFilter = search ? searchCalendarMatches : inventory;
  // No schedule rows means the whole date is bookable unless blocked; synthetic reservation windows still reduce stock.
  const filteredAssets = invalidTimeRange ? [] : assetsToFilter.flatMap(item => {
    const matchingWindows = getMatchingWindows(item, dateFilter, fromTime, toTime);
    const availableWindows = matchingWindows.filter(window => window.status === 'Available');
    const hasScheduledWindowsForDate = dateFilter && getAvailabilityWindows(item).some(window => (
      window.date === dateFilter && window.isScheduled !== false
    ));
    const unscheduledDate = Boolean(dateFilter && !hasScheduledWindowsForDate);
    if (hasAvailabilityFilter && (dateFilter
      ? !unscheduledDate && matchingWindows.length === 0
      : availableWindows.length === 0)) return [];
    return [{
      ...item,
      matchingWindows: availableWindows,
    }];
  });

  // Partial filters report the best matching slot; a complete interval must use its lowest available quantity.
  // If the selected date has no schedule or overlapping reservation window, backend availability is full stock.
  function getAvailableQuantity(item) {
    const matchingWindows = getMatchingWindows(item, dateFilter, fromTime, toTime);
    const hasScheduledWindowsForDate = dateFilter && getAvailabilityWindows(item).some(window => (
      window.date === dateFilter && window.isScheduled !== false
    ));
    if (dateFilter && !hasScheduledWindowsForDate && matchingWindows.length === 0) {
      return isEquipmentAvailable(item) ? Number(item.quantity) || 0 : 0;
    }
    const quantities = matchingWindows.map(window => Number(window.availableQuantity) || 0);
    if (fromTime && toTime && quantities.length > 0) {
      // The minimum protects against overstating stock when concurrent reservations change within the interval.
      return Math.min(...quantities);
    }
    return Math.max(0, ...quantities);
  }

  /** Restores the initial catalogue view, including closing a calendar selected through an inventory ID. */
  function clearFilters() {
    setSearchTerm('');
    setCalendarEquipmentId('');
    setDateFilter('');
    setFromTime('');
    setToTime('');
  }

  /**
   * Requires a non-empty explanation before requesting the Unavailable-to-Available transition.
   */
  async function submitRepair(event, item) {
    event.preventDefault();
    const cleanNote = resolutionNote.trim();
    if (!cleanNote) {
    // A whitespace-only reason would leave the equipment history without an auditable resolution.
      setRepairError('Enter a brief resolution note before marking equipment available.');
      return;
    }

    setRepairError('');
    setRepairSaving(true);
    try {
      await onRepairEquipment(item, cleanNote);
      setRepairingEquipmentId(null);
      setResolutionNote('');
    } catch (saveError) {
      setRepairError(saveError?.message || 'Unable to update equipment status.');
    } finally {
      setRepairSaving(false);
    }
  }

  /** Records an auditable cause before changing inventory state and notifying affected reservation owners. */
  async function submitUnavailable(event, item) {
    event.preventDefault();
    const reason = unavailabilityReason.trim();
    if (!reason) {
      setUnavailabilityError('Enter why this equipment is unavailable.');
      return;
    }

    setUnavailabilityError('');
    setUnavailabilitySaving(true);
    try {
      await onMarkUnavailable(item, reason);
      setUnavailableEquipmentId(null);
      setUnavailabilityReason('');
    } catch (saveError) {
      setUnavailabilityError(saveError?.message || 'Unable to mark equipment unavailable.');
    } finally {
      setUnavailabilitySaving(false);
    }
  }

  /** Opens the matching audited form; the inventory is unchanged until the API confirms the transition. */
  function handleStatusChange(item, nextStatus) {
    const currentStatus = getAvailabilityStatus(item);
    if (nextStatus === currentStatus) {
      setUnavailableEquipmentId(null);
      setRepairingEquipmentId(null);
      setUnavailabilityReason('');
      setResolutionNote('');
      setUnavailabilityError('');
      setRepairError('');
      return;
    }

    if (nextStatus === 'Unavailable' && onMarkUnavailable) {
      setUnavailableEquipmentId(item.id);
      setRepairingEquipmentId(null);
      setUnavailabilityReason('');
      setUnavailabilityError('');
    } else if (nextStatus === 'Available' && onRepairEquipment) {
      setRepairingEquipmentId(item.id);
      setUnavailableEquipmentId(null);
      setResolutionNote('');
      setRepairError('');
    }
  }

  return (
    <section aria-label="Equipment inventory">
      <div className="equipment-inventory-filters">
        <label>
          Search by ID or name
          <input
            aria-label="Search equipment by ID or name"
            type="search"
            placeholder="e.g. PROJ-001 or Projector"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
          />
        </label>
        <label>
          Available date
          <input
            aria-label="Filter equipment by date"
            type="date"
            value={dateFilter}
            onChange={event => setDateFilter(event.target.value)}
          />
        </label>
        <label>
          Available from
          <input
            aria-label="Available from"
            type="time"
            value={fromTime}
            max={toTime || undefined}
            onChange={event => setFromTime(event.target.value)}
          />
        </label>
        <label>
          Available to
          <input
            aria-label="Available to"
            type="time"
            value={toTime}
            min={fromTime || undefined}
            onChange={event => setToTime(event.target.value)}
          />
        </label>
        <button type="button" className="button-secondary" onClick={clearFilters} disabled={!hasFilter}>
          Clear filters
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {invalidTimeRange && <p role="alert">“Available to” must be later than “Available from”.</p>}
      {inventory.length === 0 && !error ? <p>No equipment catalogue is available.</p> : (
        <>
          {filteredAssets.length === 0 ? (
            <p role="status">{hasFilter
              ? 'No equipment matches the selected search and availability filters.'
              : 'No equipment is available.'}</p>
          ) : (
          <div className="equipment-inventory-table-wrap">
            <table className="equipment-inventory-table">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Specifications</th>
                  <th scope="col">Status</th>
                  <th scope="col">{dateFilter ? 'Available quantity' : 'Total quantity'}</th>
                  <th scope="col">Status history</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map(item => (
                  <tr key={item.id}>
                    <th scope="row"><button type="button" className="equipment-calendar-link"
                      aria-label={`View availability for ${item.asset_code}`}
                      onClick={() => setCalendarEquipmentId(String(item.id))}>{item.asset_code}</button></th>
                    <td>{item.name}</td>
                    <td>{item.specification}</td>
                    <td>
                      <div className="equipment-status-control">
                        <select
                          aria-label={`Status for ${item.asset_code}`}
                          value={getAvailabilityStatus(item)}
                          disabled={getAvailabilityStatus(item) === 'Available'
                            ? !onMarkUnavailable || unavailabilitySaving
                            : !onRepairEquipment || repairSaving}
                          onChange={event => handleStatusChange(item, event.target.value)}
                        >
                          <option value="Available">Available</option>
                          <option value="Unavailable">Unavailable</option>
                        </select>
                        {unavailableEquipmentId === item.id && (
                          <form onSubmit={event => submitUnavailable(event, item)} noValidate>
                            <label>
                              Reason for unavailability
                              <textarea
                                aria-label={`Reason for unavailability of ${item.asset_code}`}
                                value={unavailabilityReason}
                                onChange={event => {
                                  setUnavailabilityReason(event.target.value);
                                  setUnavailabilityError('');
                                }}
                                maxLength={500}
                                required
                              />
                            </label>
                            {unavailabilityError && <p role="alert">{unavailabilityError}</p>}
                            <button type="submit" disabled={unavailabilitySaving}>
                              {unavailabilitySaving ? 'Saving status…' : 'Mark Unavailable'}
                            </button>
                          </form>
                        )}
                        {repairingEquipmentId === item.id && (
                          <form onSubmit={event => submitRepair(event, item)} noValidate>
                            <label>
                              Resolution note
                              <textarea
                                aria-label="Resolution note"
                                value={resolutionNote}
                                onChange={event => {
                                  setResolutionNote(event.target.value);
                                  setRepairError('');
                                }}
                                maxLength={500}
                                required
                              />
                            </label>
                            {repairError && <p role="alert">{repairError}</p>}
                            <button type="submit" disabled={repairSaving}>
                              {repairSaving ? 'Saving repair…' : 'Confirm available'}
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                    <td>{dateFilter
                      ? `${fromTime && toTime ? '' : 'Up to '}${getAvailableQuantity(item)}`
                      : item.quantity}</td>
                    <td>
                      {item.status_history?.length ? (
                        <ul className="equipment-status-history" aria-label={`Status history for ${item.asset_code}`}>
                          {item.status_history.map(entry => (
                            <li className="equipment-status-history-entry" key={entry.id}>
                              <div className="equipment-status-history-meta">
                                <span className={`equipment-status-history-status${entry.status === 'Unavailable' ? ' is-unavailable' : ''}`}>
                                  {entry.status}
                                </span>
                                <time dateTime={entry.changed_at}>
                                  {formatHistoryDate(entry.changed_at)}
                                </time>
                              </div>
                              <p className="equipment-status-history-reason">{entry.note}</p>
                              {entry.changed_by_name && (
                                <small className="equipment-status-history-actor">By {entry.changed_by_name}</small>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : <span className="equipment-status-history-empty">No status history</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {searchCalendarAssets.length > 0 && (
            <section className="equipment-calendar-section" aria-labelledby="equipment-calendar-heading">
              <style>{CALENDAR_STYLES}</style>
              <div className="section-heading">
                <h2 id="equipment-calendar-heading">Availability calendar</h2>
              </div>
              <h3 className="equipment-calendar-selected-name">{calendarEquipment.asset_code} — {calendarEquipment.name}</h3>
              <div className="equipment-calendar-navigation" aria-label="Calendar month navigation">
                <button
                  type="button"
                  className="button-secondary"
                  aria-label="Previous month"
                  title="Previous month"
                  onClick={() => setCalendarMonth(new Date(Date.UTC(displayedMonth.getUTCFullYear(), displayedMonth.getUTCMonth() - 1, 1)))}
                  disabled={!canMoveToPreviousMonth}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m14 6-6 6 6 6" /></svg>
                </button>
                <span aria-live="polite" aria-atomic="true">
                  {getMonthLabel(displayedMonth.toISOString().slice(0, 10))}
                </span>
                <button
                  type="button"
                  className="button-secondary"
                  aria-label="Next month"
                  title="Next month"
                  onClick={() => setCalendarMonth(new Date(Date.UTC(displayedMonth.getUTCFullYear(), displayedMonth.getUTCMonth() + 1, 1)))}
                  disabled={!canMoveToNextMonth}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m10 6 6 6-6 6" /></svg>
                </button>
              </div>
              <ul className="equipment-calendar-legend" aria-label="Legend">
                <li className="is-available">Available</li>
                <li className="is-unavailable">Reserved or blocked</li>
              </ul>
              <div className="equipment-calendar-assets">
                {[calendarEquipment].map(item => (
                  <section className="equipment-calendar-asset" key={item.id}>
                    <div className="equipment-calendar-scroll">
                      <table
                        className="equipment-availability-calendar"
                        aria-label={`${item.asset_code} monthly availability`}
                      >
                        <thead>
                          <tr>
                            {WEEKDAYS.map(day => (
                              <th scope="col" key={day}>{day}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: calendarGridDates.length / 7 }, (_, week) => (
                            <tr key={week}>
                              {calendarGridDates.slice(week * 7, week * 7 + 7).map((date, dayIndex) => {
                                const isVisibleDate = date !== null;
                                const dayWindows = isVisibleDate
                                  ? getAvailabilityWindows(item).filter(window => window.date === date)
                                  : [];
                                const defaultState = isEquipmentAvailable(item)
                                  ? 'available'
                                  : 'unavailable';
                                return (
                                  <td
                                    key={date || `empty-${week}-${dayIndex}`}
                                    className={[
                                      'equipment-calendar-day',
                                      isVisibleDate ? `is-${defaultState}` : 'is-outside-range',
                                      dateFilter === date ? 'is-filtered-date' : '',
                                      date === firstVisibleDate ? 'is-today' : '',
                                    ].filter(Boolean).join(' ')}
                                    data-weekday={isVisibleDate ? WEEKDAYS[dayIndex] : undefined}
                                    aria-label={isVisibleDate
                                      ? `Availability on ${formatDate(date)} for ${item.asset_code}`
                                      : undefined}
                                  >
                                    {isVisibleDate && (
                                      <>
                                        <span className="equipment-calendar-day-number">
                                          {new Date(`${date}T00:00:00Z`).getUTCDate()}
                                        </span>
                                        {dayWindows.length === 0 ? (
                                          <>
                                            {/* A single stock label keeps quiet days compact without repeating availability. */}
                                            <strong className={`equipment-calendar-status is-${defaultState}`}>
                                              {defaultState === 'available'
                                                ? `${Number(item.quantity) || 0} available`
                                                : 'Maintenance / damage blocked'}
                                            </strong>
                                            {defaultState === 'unavailable' && (
                                              <small className="equipment-calendar-blocked-reason">{getBlockedReason(item, { status: 'Available' })}</small>
                                            )}
                                          </>
                                        ) : (
                                          <ul className="equipment-calendar-windows">
                                            {dayWindows.map((window, index) => {
                                              const state = getWindowState(item, window);
                                              const details = getWindowDetails(item, window, state) || 'Unavailable';
                                              return (
                                                <li
                                                  key={`${window.startTime}-${window.endTime}-${index}`}
                                                  className={`equipment-calendar-window is-${state}`}
                                                >
                                                  {/* Scheduled and quiet days share the same dot-and-quantity presentation. */}
                                                  <span className={`equipment-calendar-status is-${state}`}>{details}</span>
                                                </li>
                                              );
                                            })}
                                          </ul>
                                        )}
                                      </>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
