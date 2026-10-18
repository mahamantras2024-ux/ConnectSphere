// File: Displays the fixed asset catalogue and a separate calendar for searched equipment.
import { useState } from 'react';

const formatDate = value => new Intl.DateTimeFormat('en-SG', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const CALENDAR_HORIZON_DAYS = 90;
const CALENDAR_PAGE_DAYS = 14;

function calendarDateAtOffset(offset) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// Reserved slots are shown in neutral grey; the "· Reserved" text keeps the status readable without colour.
const CALENDAR_STYLES = `
.equipment-calendar-window.is-reserved {
  background: #e9ecef;
  border-color: #ced4da;
  color: #6c757d;
}
.equipment-calendar-window.is-reserved small { color: inherit; }
.equipment-calendar-window.is-partially-reserved {
  background: #fff4d6;
  border-color: #e4c36a;
  color: #624b00;
}
.equipment-calendar-window.is-blocked {
  background: #fde9e7;
  border-color: #e4a19a;
  color: #762c24;
}
@media (prefers-color-scheme: dark) {
  .equipment-calendar-window.is-reserved {
    background: #2b3138;
    border-color: #444c56;
    color: #9aa4ae;
  }
  .equipment-calendar-window.is-partially-reserved {
    background: #3b321b;
    border-color: #77632b;
    color: #f3d77e;
  }
  .equipment-calendar-window.is-blocked {
    background: #3d2422;
    border-color: #80423c;
    color: #f1aaa2;
  }
}
`;

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

// Partial bookings retain available units, so reservation quantity is considered independently of status.
const isReservedWindow = window => Number(window.reservedQuantity) > 0 ||
  (window.status !== 'Available' && (/reserv|book/i.test(String(window.status)) || Boolean(window.eventName)));
const isBlockedWindow = (item, window) => getAvailabilityStatus(item) !== 'Available' ||
  /unavailable|maintenance|damage|blocked/i.test(String(window.status));

function getBlockedReason(item, window) {
  if (window.blockReason) return window.blockReason;
  const latestStatus = item.status_history?.at(-1);
  if (latestStatus?.status === 'Unavailable' && latestStatus.note) return latestStatus.note;
  return window.status === 'Available' ? 'Equipment is unavailable.' : window.status;
}

function getWindowSummary(item, window) {
  if (isBlockedWindow(item, window)) return `Blocked · ${getBlockedReason(item, window)}`;
  const available = Number(window.availableQuantity) || 0;
  const reserved = Number(window.reservedQuantity) || 0;
  if (reserved > 0) return `${reserved} reserved · ${available} available`;
  if (window.status === 'Reserved' || window.eventName) return `${available} available · Reserved`;
  return `${available} available · Available`;
}

/**
 * Filters the read-only catalogue by asset ID/name and availability date/time range.
 * Availability range filters show only assets whose available window covers the full range.
 * Available quantities are date-specific and show the best matching window unless a full range is set.
 */
export default function EquipmentInventorySection({ inventory, error, onRepairEquipment }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [calendarPage, setCalendarPage] = useState(0);
  const [repairingEquipmentId, setRepairingEquipmentId] = useState(null);
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
      matchesFilters(window, dateFilter, fromTime, toTime) &&
      window.status === 'Available' &&
      !isBlockedWindow(item, window)
    )),
  }));
  const calendarStartOffset = calendarPage * CALENDAR_PAGE_DAYS;
  const calendarDayCount = Math.min(CALENDAR_PAGE_DAYS, CALENDAR_HORIZON_DAYS - calendarStartOffset);
  const calendarDates = Array.from({ length: calendarDayCount }, (_, index) => (
    calendarDateAtOffset(calendarStartOffset + index)
  ));

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

  return (
    <section aria-labelledby="equipment-inventory-heading">
      <style>{CALENDAR_STYLES}</style>
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
                      <span>{getAvailabilityStatus(item)}</span>
                      {onRepairEquipment && getAvailabilityStatus(item) === 'Unavailable' && (
                        repairingEquipmentId === item.id ? (
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
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setRepairingEquipmentId(item.id);
                              setResolutionNote('');
                              setRepairError('');
                            }}
                          >
                            Mark Available
                          </button>
                        )
                      )}
                    </td>
                    <td>{dateFilter
                      ? `${fromTime && toTime ? '' : 'Up to '}${getAvailableQuantity(item)}`
                      : item.quantity}</td>
                    <td>
                      {item.status_history?.length ? (
                        <ul aria-label={`Status history for ${item.asset_code}`}>
                          {item.status_history.map(entry => (
                            <li key={entry.id}>
                              <span>{entry.status}: {entry.note}</span>
                              {entry.changed_by_name && <span> — {entry.changed_by_name}</span>}
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
              <p>Only scheduled windows are shown; a dash means no window is scheduled. Unavailable equipment is blocked for its scheduled windows.</p>
              <div className="equipment-calendar-navigation" aria-label="Calendar date range">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setCalendarPage(page => Math.max(0, page - 1))}
                  disabled={calendarPage === 0}
                >
                  Previous 14 days
                </button>
                <span>
                  {formatDate(calendarDates[0])} – {formatDate(calendarDates.at(-1))}
                  {' · '}within the next 90 days
                </span>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setCalendarPage(page => page + 1)}
                  disabled={calendarStartOffset + calendarDayCount >= CALENDAR_HORIZON_DAYS}
                >
                  Next 14 days
                </button>
              </div>
              <div className="equipment-inventory-table-wrap">
                <table className="equipment-inventory-table equipment-availability-calendar" aria-label="Equipment availability calendar">
                  <thead>
                    <tr>
                      <th scope="col">ID</th>
                      {calendarDates.map(date => (
                        <th
                          key={date}
                          scope="col"
                          className={dateFilter === date ? 'is-filtered-date' : undefined}
                        >
                          {new Intl.DateTimeFormat('en-SG', {
                            weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
                          }).format(new Date(`${date}T00:00:00Z`))}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {searchCalendarAssets.map(item => (
                      <tr key={item.id}>
                        <th scope="row">{item.asset_code} — {item.name}</th>
                        {calendarDates.map(date => {
                          const dayWindows = getAvailabilityWindows(item).filter(window => window.date === date);
                          return (
                            <td
                              key={date}
                              className={dateFilter === date ? 'is-filtered-date' : undefined}
                              aria-label={`Availability on ${formatDate(date)} for ${item.asset_code}`}
                            >
                              {dayWindows.length === 0 ? (
                                <span className="equipment-calendar-empty" aria-label="No scheduled availability">—</span>
                              ) : (
                                <ul className="equipment-calendar-windows">
                                  {dayWindows.map((window, index) => {
                                    const matches = item.matchingWindows.some(matchingWindow => (
                                      matchingWindow.date === window.date &&
                                      matchingWindow.startTime === window.startTime &&
                                      matchingWindow.endTime === window.endTime
                                    ));
                                    const classes = ['equipment-calendar-window'];
                                    if (isBlockedWindow(item, window)) classes.push('is-blocked');
                                    else if (isReservedWindow(window) && Number(window.availableQuantity) > 0) {
                                      classes.push('is-partially-reserved');
                                    } else if (isReservedWindow(window)) classes.push('is-reserved');
                                    else if (matches) classes.push('is-available');
                                    return (
                                      <li
                                        key={`${window.startTime}-${window.endTime}-${index}`}
                                        className={classes.join(' ')}
                                      >
                                        <span>{window.startTime.slice(0, 5)}–{window.endTime.slice(0, 5)}</span>
                                        <small>{getWindowSummary(item, window)}</small>
                                        {window.eventName && <small>{window.eventName}</small>}
                                      </li>
                                    );
                                  })}
                                </ul>
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
          )}
        </>
      )}
    </section>
  );
}