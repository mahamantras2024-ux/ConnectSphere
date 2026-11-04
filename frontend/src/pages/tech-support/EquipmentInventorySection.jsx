// File: Displays the fixed asset catalogue and a separate calendar for searched equipment.
import { useEffect, useRef, useState } from 'react';

const formatDate = value => new Intl.DateTimeFormat('en-SG', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const getMonthLabel = value => new Intl.DateTimeFormat('en-SG', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const CALENDAR_HORIZON_DAYS = 90;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Keep the equipment grid visually aligned with the planning calendar while preserving stock and blocking semantics.
const CALENDAR_STYLES = `
.equipment-calendar-section {
  --cal-border: #dfe5d4;
  --cal-text: var(--ink);
  --cal-text-muted: #586343;
  --cal-available: #22C55E;
  --cal-unavailable: #EF4444;
  width: 100%;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  color: var(--cal-text);
}
/* Keep the header compact: typography identifies the equipment, and only navigation needs a control outline. */
.equipment-calendar-header { display: flex; flex-direction: column; align-items: center; gap: .65rem; padding: .25rem 0 .5rem; }
.equipment-calendar-section .section-heading { justify-content: center; margin: 0; text-align: center; }
.equipment-calendar-section .section-heading h2 { margin: 0; font-size: 1.35rem; letter-spacing: -.02em; }
.equipment-calendar-selected-name { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .5rem; max-width: 100%; margin: 0; text-align: center; color: var(--ink); font-size: .95rem; font-weight: 600; overflow-wrap: anywhere; }
.equipment-calendar-equipment-label { color: var(--muted); font-size: .75rem; font-weight: 500; }
.equipment-calendar-asset-label { display: inline-flex; align-items: center; gap: .45rem; max-width: 100%; padding: .35rem .65rem; border: 1px solid #dfe5d4; border-radius: 8px; background: #fff; }
.equipment-calendar-asset-code { flex-shrink: 0; padding: .2rem .4rem; border-radius: 5px; background: #e7effa; color: #244a73; font-size: .75rem; font-weight: 600; white-space: nowrap; }
.equipment-calendar-navigation { display: flex; justify-content: center; align-items: center; gap: .65rem; max-width: 100%; margin: .35rem 0 0; padding: .25rem; border: 1px solid #dfe5d4; border-radius: 10px; background: #fff; }
.equipment-calendar-navigation > span { min-width: 10rem; text-align: center; font-size: 1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.equipment-calendar-navigation button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0; padding: 0; border: 0; border-radius: 6px; background: transparent; }
.equipment-calendar-navigation button:hover:not(:disabled) { background: #f0f3e8; box-shadow: none; }
.equipment-calendar-navigation button:focus-visible { outline: 2px solid #536d37; outline-offset: 2px; }
.equipment-calendar-assets, .equipment-calendar-asset { min-width: 0; }
.equipment-calendar-scroll { overflow-x: auto; border: 1px solid var(--cal-border); border-radius: 14px; margin-top: 1rem; background: #fff; }
.equipment-availability-calendar { width: 100%; min-width: 770px; table-layout: fixed; border-collapse: collapse; }
/* Scope table and list rules to protect the calendar from the dashboard's inventory styles. */
.equipment-calendar-section .equipment-availability-calendar th { padding: .8rem; background: #f3f5ec; color: #586343; text-align: left; font-size: .8rem; text-transform: none; letter-spacing: 0; }
.equipment-calendar-section .equipment-availability-calendar td { height: 135px; vertical-align: top; text-align: left; padding: .6rem; border-top: 1px solid #e3e7dc; border-right: 1px solid #e3e7dc; }
.equipment-calendar-section .equipment-availability-calendar td:last-child { border-right: 0; }
.equipment-calendar-day.is-outside-range { background: #fafbf7; }
.equipment-calendar-day.is-filtered-date { outline: 2px solid #536d37; outline-offset: -2px; }
.equipment-calendar-day-number { display: block; font-size: .8rem; font-weight: 650; margin-bottom: .55rem; }
.equipment-calendar-section .equipment-calendar-windows { display: grid; gap: .4rem; margin: 0; padding: 0 !important; list-style: none; }
.equipment-calendar-section .equipment-calendar-windows li { list-style: none; margin: 0; }
.equipment-calendar-section .equipment-calendar-windows li::before,
.equipment-calendar-section .equipment-calendar-windows li::after { content: none; display: none; }
.equipment-calendar-window, .equipment-calendar-day > .equipment-calendar-status { padding: 0; background: transparent; color: var(--cal-text-muted); overflow-wrap: anywhere; }
.equipment-calendar-window { display: grid; gap: .25rem; min-width: 0; }
/* Dots identify availability without filling each day with a coloured card. */
.equipment-calendar-status::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: .4rem; border-radius: 50%; background: var(--cal-available); vertical-align: middle; }
.equipment-calendar-status.is-unavailable::before { background: var(--cal-unavailable); }
.equipment-calendar-status { display: block; font-size: .8rem; font-weight: 400; line-height: 1.4; }
.equipment-calendar-blocked-reason { display: block; margin-top: .4rem; color: #8B2E2E; font-size: .7rem; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .equipment-calendar-section .section-heading h2 { font-size: 1.25rem; }
  .equipment-calendar-navigation { gap: .35rem; }
  .equipment-calendar-navigation > span { min-width: 0; padding: 0 .5rem; font-size: 1rem; }
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
  const [calendarSelection, setCalendarSelection] = useState({ id: '', navigate: false });
  const calendarEquipmentId = calendarSelection.id;
  const calendarHeadingRef = useRef(null);
  // Navigate after React renders the selected calendar, including repeated clicks on the same asset.
  useEffect(() => {
    if (!calendarSelection.navigate) return;
    calendarHeadingRef.current?.focus({ preventScroll: true });
    calendarHeadingRef.current?.scrollIntoView?.({ block: 'start' });
  }, [calendarSelection]);
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
    setCalendarSelection({ id: '', navigate: false });
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
                  <th scope="col">Calendar</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map(item => (
                  <tr key={item.id}>
                    <th scope="row">{item.asset_code}</th>
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
                    <td>
                      <button type="button" className="equipment-calendar-link"
                        aria-label={`View calendar for ${item.asset_code}`} title="View calendar"
                        onClick={() => setCalendarSelection({ id: String(item.id), navigate: true })}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="5" width="18" height="16" rx="2" />
                          <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2" />
                        </svg>
                      </button>
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
              <div className="equipment-calendar-header">
                <div className="section-heading">
                  <h2 id="equipment-calendar-heading" ref={calendarHeadingRef} tabIndex={-1}>
                    Availability calendar
                  </h2>
                </div>
                <h3 className="equipment-calendar-selected-name">
                  <span className="equipment-calendar-equipment-label">Equipment</span>{' '}
                  <span className="equipment-calendar-asset-label"><span className="equipment-calendar-asset-code">{calendarEquipment.asset_code}</span>{' — '}{calendarEquipment.name}</span>
                </h3>
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
              </div>
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
                                                  {/* Scheduled and quiet days use the same availability card treatment. */}
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
