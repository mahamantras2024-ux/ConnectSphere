// File: Displays the fixed asset catalogue and a separate calendar for searched equipment.
import { useState } from 'react';

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

/**
 * Filters the read-only catalogue by asset ID/name and availability date/time range.
 * Availability range filters show only assets whose available window covers the full range.
 * The calendar is kept separate from the catalogue and appears only for a non-empty search.
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
    if (hasAvailabilityFilter && availableWindows.length === 0) return [];
    return [{
      ...item,
      matchingWindows: availableWindows.filter(window => (
        matchesFilters(window, dateFilter, fromTime, toTime)
      )),
    }];
  });

  function clearFilters() {
    setSearchTerm('');
    setDateFilter('');
    setFromTime('');
    setToTime('');
  }

  return (
    <section aria-labelledby="equipment-inventory-heading">
      <div className="section-heading">
        <h2 id="equipment-inventory-heading">Equipment inventory</h2>
      </div>
      <p>
        Showing {filteredAssets.length} of {inventory.length} pre-provisioned physical assets.
        {' '}Search for an asset to view its availability calendar below.
      </p>
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
              <caption>
                {hasFilter
                  ? `Equipment matching filters${dateFilter ? ` on ${formatDate(dateFilter)}` : ''}${fromTime ? ` from ${fromTime}` : ''}${toTime ? ` to ${toTime}` : ''}`
                  : 'Equipment catalogue'}
              </caption>
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Specifications</th>
                  <th scope="col">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map(item => (
                  <tr key={item.id}>
                    <th scope="row">{item.asset_code}</th>
                    <td>{item.name}</td>
                    <td>{item.specification}</td>
                    <td>{item.quantity}</td>
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
              <p>Calendar for equipment matching “{searchTerm.trim()}”. Matching available windows are highlighted.</p>
              <div className="equipment-inventory-table-wrap">
                <table className="equipment-inventory-table equipment-availability-calendar">
                  <caption>Equipment availability calendar</caption>
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
                                    return (
                                      <li
                                        key={`${window.startTime}-${window.endTime}-${index}`}
                                        className={matches ? 'equipment-calendar-window is-available' : 'equipment-calendar-window'}
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
