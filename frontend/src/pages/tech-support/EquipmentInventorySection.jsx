// File: Displays the fixed asset catalogue and a separate calendar for searched equipment.
import { useState } from 'react';

const formatDate = value => new Intl.DateTimeFormat('en-SG', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const formatHistoryDate = value => new Intl.DateTimeFormat('en-SG', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(value));

// Reserved slots are shown in neutral grey; the "· Reserved" text keeps the status readable without colour.
const CALENDAR_STYLES = `
.equipment-calendar-window.is-reserved {
  background: #e9ecef;
  border-color: #ced4da;
  color: #6c757d;
}
.equipment-calendar-window.is-reserved small { color: inherit; }
@media (prefers-color-scheme: dark) {
  .equipment-calendar-window.is-reserved {
    background: #2b3138;
    border-color: #444c56;
    color: #9aa4ae;
  }
}
.equipment-status-control { display: grid; gap: 8px; }
.equipment-status-control select { min-width: 132px; padding: 8px 10px; border: 1px solid #c8cec1; border-radius: 8px; background: #fff; color: #25322a; }
.equipment-status-control form { display: grid; gap: 6px; }
.equipment-status-control textarea { width: 100%; min-height: 64px; }
.equipment-inventory-table th:last-child,
.equipment-inventory-table td:last-child { min-width: 280px; }
.equipment-status-history { display: grid; min-width: 250px; gap: 8px; margin: 0; padding: 0 !important; list-style: none; }
.equipment-status-history-entry { padding: 9px 11px; border: 1px solid #e4e9df; border-radius: 8px; background: #fbfcf8; }
.equipment-status-history-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.equipment-status-history-status { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px; border-radius: 999px; background: #eef2e8; color: #43583b; font-size: 11px; font-weight: 700; }
.equipment-status-history-status.is-unavailable { background: #fff0e8; color: #a3431b; }
.equipment-status-history-meta time { flex: 0 0 auto; color: #71796e; font-size: 11px; white-space: nowrap; }
.equipment-status-history-reason { margin: 7px 0 0; color: #333b32; overflow-wrap: anywhere; font-size: 12px; line-height: 1.45; }
.equipment-status-history-actor { display: block; margin-top: 5px; color: #71796e; font-size: 11px; }
.equipment-status-history-empty { color: #788073; font-size: 12px; }
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

// A window is reserved when it is not open and is tied to a reservation (status says so, or an event holds it).
const isReservedWindow = window => window.status !== 'Available' &&
  (/reserv|book/i.test(String(window.status)) || Boolean(window.eventName));

/**
 * Filters the read-only catalogue by asset ID/name and availability date/time range.
 * Availability range filters show only assets whose available window covers the full range.
 * Available quantities are date-specific and show the best matching window unless a full range is set.
 */
export default function EquipmentInventorySection({ inventory, error, onRepairEquipment, onMarkUnavailable }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [repairingEquipmentId, setRepairingEquipmentId] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [repairError, setRepairError] = useState('');
  const [repairSaving, setRepairSaving] = useState(false);
  const [unavailableEquipmentId, setUnavailableEquipmentId] = useState(null);
  const [unavailabilityReason, setUnavailabilityReason] = useState('');
  const [unavailabilityError, setUnavailabilityError] = useState('');
  const [unavailabilitySaving, setUnavailabilitySaving] = useState(false);
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
      matchesFilters(window, dateFilter, fromTime, toTime) && window.status === 'Available'
    )),
  }));
  const calendarDates = [...new Set(searchCalendarAssets.flatMap(item => (
    getAvailabilityWindows(item).map(window => window.date)
  )))].sort();

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

  /** Starts or cancels an audited status transition without changing inventory before confirmation. */
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
                              {unavailabilitySaving ? 'Saving…' : 'Confirm unavailable'}
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
          {searchTerm.trim() && searchCalendarAssets.length > 0 && (
            <section className="equipment-calendar-section" aria-labelledby="equipment-calendar-heading">
              <div className="section-heading">
                <h3 id="equipment-calendar-heading">Availability calendar</h3>
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
                              {dayWindows.length === 0 ? <span className="equipment-calendar-empty">—</span> : (
                                <ul className="equipment-calendar-windows">
                                  {dayWindows.map((window, index) => {
                                    const matches = item.matchingWindows.some(matchingWindow => (
                                      matchingWindow.date === window.date &&
                                      matchingWindow.startTime === window.startTime &&
                                      matchingWindow.endTime === window.endTime
                                    ));
                                    const classes = ['equipment-calendar-window'];
                                    if (matches) classes.push('is-available');
                                    else if (isReservedWindow(window)) classes.push('is-reserved');
                                    return (
                                      <li
                                        key={`${window.startTime}-${window.endTime}-${index}`}
                                        className={classes.join(' ')}
                                      >
                                        <span>{window.startTime.slice(0, 5)}–{window.endTime.slice(0, 5)}</span>
                                        <small>{window.availableQuantity} available · {window.status}</small>
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