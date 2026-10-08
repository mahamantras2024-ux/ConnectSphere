// File: Displays the fixed asset catalogue and a separate calendar for searched equipment.
import { useState } from 'react';

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
`;

const formatDate = value => value
  ? new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`))
  : 'Not provided';

function matchesFilters(window, date, fromTime, toTime) {
  if (date && window.date !== date) return false;
  if (fromTime && window.startTime.slice(0, 5) > fromTime) return false;
  if (toTime && window.endTime.slice(0, 5) < toTime) return false;
  if (fromTime && !toTime && window.endTime.slice(0, 5) <= fromTime) return false;
  if (toTime && !fromTime && window.startTime.slice(0, 5) >= toTime) return false;
  return true;
}

const getAvailabilityWindows = item => Array.isArray(item.availabilities) ? item.availabilities : [];

// A window is reserved when it is not open and is tied to a reservation (status says so, or an event holds it).
const isReservedWindow = window => window.status !== 'Available' &&
  (/reserv|book/i.test(String(window.status)) || Boolean(window.eventName));

/**
 * Filters the read-only catalogue by asset ID/name and availability date/time range.
 * Availability range filters show only assets whose available window covers the full range.
 * Available quantities are date-specific and show the best matching window unless a full range is set.
 */
export default function EquipmentInventorySection({ inventory, error }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
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
    if (!dateFilter) return null;
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
                  <th scope="col">{dateFilter ? 'Available quantity' : 'Total quantity'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map(item => (
                  <tr key={item.id}>
                    <th scope="row">{item.asset_code}</th>
                    <td>{item.name}</td>
                    <td>{item.specification}</td>
                    <td>{dateFilter
                      ? `${fromTime && toTime ? '' : 'Up to '}${getAvailableQuantity(item)}`
                      : item.quantity}</td>
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
                <table className="equipment-inventory-table equipment-availability-calendar">
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