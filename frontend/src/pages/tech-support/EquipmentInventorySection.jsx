// File: Displays the fixed asset catalogue and a separate calendar for searched equipment.
import { useState } from 'react';

const formatDate = value => new Intl.DateTimeFormat('en-SG', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const getMonthLabel = value => new Intl.DateTimeFormat('en-SG', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const CALENDAR_HORIZON_DAYS = 90;

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

function matchesFilters(window, date, fromTime, toTime) {
  if (date && window.date !== date) return false;
  if (fromTime && window.startTime.slice(0, 5) > fromTime) return false;
  if (toTime && window.endTime.slice(0, 5) < toTime) return false;
  if (fromTime && !toTime && window.endTime.slice(0, 5) <= fromTime) return false;
  if (toTime && !fromTime && window.startTime.slice(0, 5) >= toTime) return false;
  return true;
}

const getAvailabilityWindows = item => Array.isArray(item.availabilities) ? item.availabilities : [];
// Legacy stock health values map onto explicit availability until a record is transitioned by staff.
const getAvailabilityStatus = item => item.availability_status ||
  (item.status && item.status !== 'operational' ? 'Unavailable' : 'Available');
const formatHistoryDate = value => value
  ? new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value))
  : 'Date unavailable';

const isBlockedWindow = (item, window) => getAvailabilityStatus(item) !== 'Available' ||
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

function getWindowDetails(item, window, state) {
  const available = Number(window.availableQuantity) || 0;
  const reserved = Number(window.reservedQuantity) || 0;
  const hasReservation = reserved > 0 || /reserv|book|hold/i.test(String(window.status)) || Boolean(window.eventName);
  if (state === 'unavailable') {
    if (hasReservation) return `${reserved} reserved · ${available} available`;
    return getBlockedReason(item, window);
  }
  if (reserved > 0) return `${reserved} reserved · ${available} available`;
  return `${available} available`;
}

/**
 * Filters the inventory by asset ID/name and availability range, and shows a month calendar for searched equipment.
 * Date/time filters retain assets whose recorded windows cover the requested range; status callbacks persist audited
 * availability transitions and return the updated inventory row through the dashboard.
 */
export default function EquipmentInventorySection({
  inventory,
  error,
  onRepairEquipment,
  onMarkUnavailable,
}) {
  const [searchTerm, setSearchTerm] = useState('');
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
    : [];
  const searchCalendarAssets = searchCalendarMatches.map(item => ({
    ...item,
    matchingWindows: getAvailabilityWindows(item).filter(window => (
      window.date >= calendarDateAtOffset(0) &&
      window.date < calendarDateAtOffset(CALENDAR_HORIZON_DAYS) &&
      matchesFilters(window, dateFilter, fromTime, toTime)
    )),
  }));
  const calendarGridDates = getMonthGridDates(
    calendarMonth,
    calendarDateAtOffset(0),
    calendarDateAtOffset(CALENDAR_HORIZON_DAYS - 1),
  );
  const earliestMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const canMoveToPreviousMonth = calendarMonth.getTime() > earliestMonth.getTime();
  const nextMonthStart = new Date(Date.UTC(calendarMonth.getUTCFullYear(), calendarMonth.getUTCMonth() + 1, 1));
  const latestVisibleDate = new Date(today);
  latestVisibleDate.setUTCDate(today.getUTCDate() + CALENDAR_HORIZON_DAYS);
  const canMoveToNextMonth = nextMonthStart.getTime() < latestVisibleDate.getTime();

  const assetsToFilter = search ? searchCalendarMatches : inventory;
  const filteredAssets = invalidTimeRange ? [] : assetsToFilter.flatMap(item => {
    const matchingWindows = getAvailabilityWindows(item).filter(window => (
      matchesFilters(window, dateFilter, fromTime, toTime)
    ));
    const availableWindows = matchingWindows.filter(window => window.status === 'Available');
    if (hasAvailabilityFilter && (dateFilter ? matchingWindows : availableWindows).length === 0) return [];
    return [{
      ...item,
      matchingWindows: availableWindows,
    }];
  });

  // A date without a complete time range may match several windows, so report the best slot as an upper bound.
  function getAvailableQuantity(item) {
    const matchingWindows = getAvailabilityWindows(item).filter(window => (
      matchesFilters(window, dateFilter, fromTime, toTime)
    ));
    return Math.max(0, ...matchingWindows.map(window => Number(window.availableQuantity) || 0));
  }

  function clearFilters() {
    setSearchTerm('');
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

  /** Records an auditable reason before marking equipment unavailable and flagging affected reservations. */
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
    <section aria-labelledby="equipment-inventory-heading">
      <div className="section-heading">
        <h2 id="equipment-inventory-heading">Equipment inventory</h2>
      </div>
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
                              {repairSaving ? 'Saving repair…' : 'Mark Available'}
                            </button>
                          </form>
                        )
                        }
                      </div>
                    </td>
                    <td>{dateFilter
                      ? `${fromTime && toTime ? '' : 'Up to '}${getAvailableQuantity(item)}`
                      : item.quantity}</td>
                    <td>
                      {item.status_history?.length ? (
                        <ul className="equipment-status-history" aria-label={`Status history for ${item.asset_code}`}>
                          {item.status_history.map(entry => (
                            <li key={entry.id}>
                              <div className="equipment-status-history-heading">
                                <span className={`equipment-status-history-status is-${entry.status.toLowerCase()}`}>
                                  {entry.status}
                                </span>
                                <time dateTime={entry.changed_at}>{formatHistoryDate(entry.changed_at)}</time>
                              </div>
                              <p className="equipment-status-history-note">{entry.note}</p>
                              {entry.changed_by_name && (
                                <span className="equipment-status-history-meta">
                                  Changed by {entry.changed_by_name}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : 'No status history'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {searchTerm.trim() && searchCalendarAssets.length > 0 && (
            <section className="equipment-calendar-section" aria-labelledby="equipment-calendar-heading">
              <div className="section-heading">
                <h3 id="equipment-calendar-heading">Availability calendar</h3>
              </div>
              <p className="equipment-calendar-note">
                Unscheduled dates are available unless the equipment is marked unavailable.
              </p>
              <div className="equipment-calendar-navigation" aria-label="Calendar month navigation">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setCalendarMonth(current => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)))}
                  disabled={!canMoveToPreviousMonth}
                >
                  Previous month
                </button>
                <span>
                  {getMonthLabel(calendarMonth.toISOString().slice(0, 10))}
                </span>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setCalendarMonth(current => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)))}
                  disabled={!canMoveToNextMonth}
                >
                  Next month
                </button>
              </div>
              <div className="equipment-calendar-assets">
                {searchCalendarAssets.map(item => (
                  <section className="equipment-calendar-asset" key={item.id}>
                    <h4>{item.asset_code} — {item.name}</h4>
                    <table
                      className="equipment-availability-calendar"
                      aria-label={`${item.asset_code} monthly availability`}
                    >
                      <thead>
                        <tr>
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
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
                              const defaultState = getAvailabilityStatus(item) === 'Available'
                                ? 'available'
                                : 'unavailable';
                              return (
                                <td
                                  key={date || `empty-${week}-${dayIndex}`}
                                  className={[
                                    'equipment-calendar-day',
                                    isVisibleDate ? `is-${defaultState}` : 'is-outside-range',
                                    dateFilter === date ? 'is-filtered-date' : '',
                                  ].filter(Boolean).join(' ')}
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
                                        <strong className={`equipment-calendar-status is-${defaultState}`}>
                                          {defaultState === 'available' ? 'Available' : 'Unavailable'}
                                        </strong>
                                      ) : (
                                        <ul className="equipment-calendar-windows">
                                          {dayWindows.map((window, index) => {
                                            const state = getWindowState(item, window);
                                            const statusLabel = state === 'available' ? 'Available' : 'Unavailable';
                                            return (
                                              <li
                                                key={`${window.startTime}-${window.endTime}-${index}`}
                                                className={`equipment-calendar-window is-${state}`}
                                              >
                                                <span className="equipment-calendar-time">
                                                  {window.startTime.slice(0, 5)}–{window.endTime.slice(0, 5)}
                                                </span>
                                                <strong className={`equipment-calendar-status is-${state}`}>
                                                  {statusLabel}
                                                </strong>
                                                <small>{getWindowDetails(item, window, state)}</small>
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