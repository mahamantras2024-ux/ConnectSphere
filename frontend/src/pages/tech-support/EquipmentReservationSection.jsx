// File: Checks matching asset availability and confirms event-specific reservations.
import { useState } from 'react';
import { api } from '../../api/client';

const STYLES = `
/* Scoped styles for EquipmentReservationSection. Everything is prefixed "er-" so it won't clash with existing classes. */
.er-root {
  --er-ink: #1c2530;
  --er-muted: #5b6776;
  --er-line: #d9dee5;
  --er-surface: #ffffff;
  --er-wash: #f4f6f8;
  --er-accent: #424f19;
  --er-accent-ink: #ffffff;
  --er-ok: #28a745;
  --er-ok-ink: #155724;
  --er-ok-bg: #d4edda;
  --er-warn-ink: #856404;
  --er-warn-bg: #fff3cd;
  --er-bad: #dc3545;
  --er-bad-ink: #721c24;
  --er-bad-bg: #f8d7da;
  --er-radius: 8px;
  color: var(--er-ink);
}
@media (prefers-color-scheme: dark) {
  .er-root {
    --er-ink: #e7ebf0;
    --er-muted: #9aa6b4;
    --er-line: #324050;
    --er-surface: #1a222c;
    --er-wash: #212b37;
    --er-accent: #4cc26b;
    --er-accent-ink: #0b1f12;
    --er-ok: #4cc26b;
    --er-ok-ink: #8fe0a6;
    --er-ok-bg: #173a27;
    --er-warn-ink: #f0c070;
    --er-warn-bg: #3d2f12;
    --er-bad: #ff6b78;
    --er-bad-ink: #f5a3aa;
    --er-bad-bg: #402022;
  }
}

.er-section { margin-block: 0 40px; }
.er-section-title { font-size: 1.25rem; margin: 0 0 4px; }
.er-section-hint { margin: 0 0 20px; color: var(--er-muted); max-width: 65ch; }

.er-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr)); align-items: start; }

/* Card */
.er-card { background: var(--er-surface); border: 1px solid var(--er-line); border-radius: var(--er-radius); overflow: hidden; }
.er-card-head { padding: 20px; border-bottom: 1px solid var(--er-line); }
.er-card-title-row { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.er-card-title { margin: 0; font-size: 1.1rem; }
.er-meta { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 12px 0 0; font-size: .925rem; }
.er-meta dt { color: var(--er-muted); }
.er-meta dd { margin: 0; }
.er-review-note { margin: 12px 0 0; font-size: .875rem; color: var(--er-muted); }
.er-card-body { padding: 20px; display: grid; gap: 20px; }
.er-sub { font-size: .95rem; margin: 0 0 8px; }

/* Badges */
.er-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; white-space: nowrap; }
.er-badge--ok { color: var(--er-ok-ink); background: var(--er-ok-bg); }
.er-badge--warn { color: var(--er-warn-ink); background: var(--er-warn-bg); }
.er-badge--bad { color: var(--er-bad-ink); background: var(--er-bad-bg); }

/* Requested list */
.er-requested { list-style: none; margin: 0; padding: 0; border: 1px solid var(--er-line); border-radius: var(--er-radius); }
.er-requested li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; }
.er-requested li + li { border-top: 1px solid var(--er-line); }
.er-qty { font-variant-numeric: tabular-nums; color: var(--er-muted); }
.er-requirements { display: grid; grid-template-columns: minmax(9rem, max-content) minmax(0, 1fr); gap: 8px 16px; margin: 12px 0 0; }
.er-requirements dt { color: var(--er-muted); }
.er-requirements dd { margin: 0; overflow-wrap: anywhere; }

/* Additional equipment */
.er-extra { display: grid; gap: 12px; border: 1px dashed var(--er-line); border-radius: var(--er-radius); padding: 16px; margin: 0; min-width: 0; }
.er-extra legend { padding: 0 8px; margin-left: -8px; font-weight: 600; font-size: .95rem; }
.er-extra-row { display: grid; grid-template-columns: minmax(0, 1fr) 88px 38px; gap: 12px; align-items: end; }
.er-extra-add { justify-self: start; }
.er-field { display: grid; gap: 6px; font-size: .85rem; color: var(--er-muted); min-width: 0; }
.er-field input { font: inherit; color: var(--er-ink); background: var(--er-surface); border: 1px solid var(--er-line); border-radius: 6px; padding: 0 10px; height: 38px; width: 100%; box-sizing: border-box; }

/* Buttons */
.er-btn { font: inherit; font-weight: 600; cursor: pointer; border-radius: 6px; padding: 8px 14px; border: 1px solid var(--er-accent); background: var(--er-accent); color: var(--er-accent-ink); }
.er-btn--quiet { background: transparent; color: var(--er-accent); border-color: var(--er-line); }
.er-btn--danger { color: var(--er-bad); }
.er-btn:hover:not(:disabled) { filter: brightness(1.08); }
.er-btn:disabled { opacity: .5; cursor: not-allowed; }
.er-btn:focus-visible, .er-field input:focus-visible, .er-stepper input:focus-visible { outline: 3px solid var(--er-accent); outline-offset: 2px; }

/* Icon buttons */
.er-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; padding: 0; cursor: pointer; border-radius: 6px; border: 1px solid var(--er-line); background: transparent; color: var(--er-accent); }
.er-icon-btn--danger { color: var(--er-bad-ink); }
.er-icon-btn:hover:not(:disabled) { background: var(--er-wash); }
.er-icon-btn:disabled { opacity: .5; cursor: not-allowed; }
.er-icon-btn:focus-visible { outline: 3px solid var(--er-accent); outline-offset: 2px; }

/* Availability */
.er-avail { display: grid; gap: 16px; }
.er-item { border: 1px solid var(--er-line); border-radius: var(--er-radius); margin: 0; padding: 0; min-width: 0; }
.er-item legend { padding: 0; }
.er-item-head { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--er-wash); border-bottom: 1px solid var(--er-line); border-radius: var(--er-radius) var(--er-radius) 0 0; width: 100%; box-sizing: border-box; }
.er-item-name { font-weight: 600; }
.er-item-count { font-size: .85rem; color: var(--er-muted); font-variant-numeric: tabular-nums; }
.er-empty-note { margin: 0; padding: 12px 16px; color: var(--er-muted); font-size: .9rem; }
.er-asset { display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: space-between; align-items: center; padding: 12px 16px; }
.er-asset + .er-asset { border-top: 1px solid var(--er-line); }
.er-asset-info { min-width: 0; flex: 1 1 220px; }
.er-asset-code { font-weight: 600; font-size: .9rem; }
.er-asset-spec { display: block; color: var(--er-muted); font-size: .85rem; }
.er-stepper { display: grid; justify-items: end; gap: 2px; }
.er-stepper input { width: 72px; font: inherit; text-align: center; padding: 6px; border: 1px solid var(--er-line); border-radius: 6px; background: var(--er-surface); color: var(--er-ink); }
.er-stepper small { color: var(--er-muted); }

/* Action bar */
.er-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding-top: 4px; }
.er-actions .er-status { flex: 1 1 100%; margin: 0; font-size: .875rem; color: var(--er-warn-ink); }
.er-error { margin: 0; padding: 10px 12px; border-radius: 6px; color: var(--er-bad-ink); background: var(--er-bad-bg); border: 1px solid var(--er-bad); font-size: .9rem; }

/* Empty state */
.er-empty { border: 1px dashed var(--er-line); border-radius: var(--er-radius); padding: 32px 20px; text-align: center; background: var(--er-wash); }
.er-empty h3 { margin: 0 0 4px; }
.er-empty p { margin: 0 0 16px; color: var(--er-muted); }

/* Reservations table */
.er-table-wrap { overflow-x: auto; border: 1px solid var(--er-line); border-radius: var(--er-radius); background: var(--er-surface); }
.er-table { width: 100%; border-collapse: collapse; font-size: .925rem; }
.er-table th, .er-table td { text-align: left; padding: 12px 16px; vertical-align: top; }
.er-table thead th { background: var(--er-wash); color: var(--er-muted); font-weight: 600; font-size: .85rem; border-bottom: 1px solid var(--er-line); white-space: nowrap; }
.er-table tbody tr + tr > * { border-top: 1px solid var(--er-line); }
.er-table tbody th { font-weight: 600; }
.er-table .er-cell-sub { display: block; color: var(--er-muted); font-size: .85rem; }
.er-chip-list { display: grid; gap: 4px; }
.er-chip { font-size: .85rem; }

@media (prefers-reduced-motion: no-preference) {
  .er-btn { transition: filter .15s; }
}
`;

const iconProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' };
const PlusIcon = () => <svg {...iconProps}><path d="M12 5v14M5 12h14" /></svg>;
const TrashIcon = () => (
  <svg {...iconProps}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg>
);

const formatDate = value => value
  ? new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`))
  : 'Not provided';
const formatTime = value => value?.slice(0, 5) || 'Not provided';
const sentenceCase = value => { const text = String(value).replaceAll('_', ' '); return text.charAt(0).toUpperCase() + text.slice(1); };
const normaliseItemName = value => String(value).trim().toLocaleLowerCase();

function containsRequestedQuantities(items, selectedSelections) {
  const requestedCounts = new Map();
  for (const item of items) {
    const key = normaliseItemName(item.item);
    requestedCounts.set(key, (requestedCounts.get(key) || 0) + (item.requestedQuantity ?? item.quantity));
  }
  const selectedCounts = new Map();
  for (const { asset, quantity } of selectedSelections) {
    const key = normaliseItemName(asset.name);
    selectedCounts.set(key, (selectedCounts.get(key) || 0) + quantity);
  }
  return [...requestedCounts].every(([name, quantity]) => selectedCounts.get(name) === quantity);
}

function availabilityBadge(item) {
  if (item.availableQuantity === 0) return { label: 'Not available', tone: 'er-badge--bad' };
  if (item.availableQuantity < item.requestedQuantity) return { label: 'Partially available', tone: 'er-badge--warn' };
  return { label: 'Available', tone: 'er-badge--ok' };
}

/**
 * Lets staff allocate available stock quantities and confirms them atomically.
 * Full reviews require every itemized unit; staff-entered additions may be included when available.
 */
/**
 * Presents the reviewed event's complete equipment and technical requirements alongside its reservation controls.
 */
function ReservationCandidate({ request, token, onReserved }) {
  const [availability, setAvailability] = useState(null);
  const [selectedQuantities, setSelectedQuantities] = useState({});
  const [additionalItems, setAdditionalItems] = useState([{ item: '', quantity: 1 }]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const equipmentItems = Array.isArray(request.equipment_items) ? request.equipment_items : [];
  const equipmentNotes = request.equipment_notes?.trim() ? request.equipment_notes : null;
  const technicalSupportDetails = request.technical_support_details?.trim() ? request.technical_support_details : null;
  const technicalSpecifications = request.technical_specifications?.trim() ? request.technical_specifications : null;
  const hasEquipmentDetails = equipmentItems.length > 0 || equipmentNotes || request.technical_support_required ||
    technicalSupportDetails || request.video_conferencing_required || technicalSpecifications;

  async function checkAvailability() {
    setLoading(true);
    setError('');
    setAvailability(null);
    // Keep manually identified equipment in the availability request without changing the reviewed event record.
    const enteredItems = additionalItems
      .filter(item => item.item.trim())
      .map(item => ({ item: item.item.trim(), quantity: Number(item.quantity) }));
    try {
      const path = `/events/${request.id}/equipment-availability`;
      const data = enteredItems.length
        ? await api.post(path, { additionalItems: enteredItems }, token)
        : await api.get(path, token);
      setAvailability(data.availability);
      const defaults = {};
      if (request.review_outcome === 'fully_fulfillable') {
        for (const item of data.availability.items) {
          let remaining = item.requestedQuantity;
          for (const asset of item.availableAssets) {
            const quantity = Math.min(remaining, asset.available_quantity);
            defaults[asset.id] = quantity;
            remaining -= quantity;
          }
        }
      }
      setSelectedQuantities(defaults);
    } catch (loadError) {
      setError(loadError.message || 'Unable to check equipment availability.');
    } finally {
      setLoading(false);
    }
  }

  function updateQuantity(assetId, quantity) {
    setSelectedQuantities(current => ({ ...current, [assetId]: quantity }));
  }

  function updateAdditionalItem(index, changes) {
    // Any manual edit invalidates the previous slot results so stale availability cannot be reserved.
    setAvailability(null);
    setAdditionalItems(current => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...changes } : item
    )));
  }

  function addAdditionalItem() {
    setAvailability(null);
    setAdditionalItems(current => [...current, { item: '', quantity: 1 }]);
  }

  function removeAdditionalItem(index) {
    setAvailability(null);
    setAdditionalItems(current => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function reserve(event) {
    event.preventDefault();
    const selectedSelections = availability.items.flatMap(item => item.availableAssets)
      .map(asset => ({ asset, quantity: Number(selectedQuantities[asset.id]) || 0 }))
      .filter(selection => selection.quantity > 0);
    const fulfillsAllRequests = containsRequestedQuantities(request.equipment_items || [], selectedSelections);
    if (request.review_outcome === 'fully_fulfillable' && !fulfillsAllRequests) {
      setError('A fully fulfillable request requires every requested unit to be selected.');
      return;
    }
    if (selectedSelections.length === 0) {
      setError('Select at least one available equipment quantity.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const enteredItems = additionalItems
        .filter(item => item.item.trim())
        .map(item => ({ item: item.item.trim(), quantity: Number(item.quantity) }));
      const data = await api.post(`/events/${request.id}/equipment-reservations`, {
        selections: selectedSelections.map(({ asset, quantity }) => ({ inventoryId: asset.id, quantity })),
        ...(enteredItems.length ? { additionalItems: enteredItems } : {}),
      }, token);
      onReserved({
        ...data.reservation,
        event_name: request.name,
        items: data.items,
      });
    } catch (saveError) {
      setError(saveError.message || 'Unable to confirm this reservation.');
    } finally {
      setSaving(false);
    }
  }

  const selectedSelections = availability
    ? availability.items.flatMap(item => item.availableAssets)
      .map(asset => ({ asset, quantity: Number(selectedQuantities[asset.id]) || 0 }))
      .filter(selection => selection.quantity > 0)
    : [];
  const meetsFullRequest = availability &&
    containsRequestedQuantities(request.equipment_items || [], selectedSelections);
  const canReserve = selectedSelections.length > 0 &&
    (request.review_outcome !== 'fully_fulfillable' || meetsFullRequest);
  const totalSelected = selectedSelections.reduce((sum, { quantity }) => sum + quantity, 0);

  return (
    <article className="er-card" aria-labelledby={`reservation-candidate-${request.id}`}>
      <header className="er-card-head">
        <h3 className="er-card-title" id={`reservation-candidate-${request.id}`}>{request.name}</h3>
        <dl className="er-meta">
          <dt>Date</dt>
          <dd>{formatDate(request.proposed_date)}</dd>
          <dt>Time</dt>
          <dd>{formatTime(request.proposed_start_time)}–{formatTime(request.proposed_end_time)}</dd>
          <dt>Venue</dt>
          <dd>{request.venue_name || 'Not confirmed'}{request.venue_location ? `, ${request.venue_location}` : ''}</dd>
          <dt>Review status</dt>
          <dd>{sentenceCase(request.review_outcome)}</dd>
        </dl>
        {request.review_reason && <p className="er-review-note">Review note: {request.review_reason}</p>}
      </header>

      <div className="er-card-body">
        {hasEquipmentDetails && (
          <section>
            <h4 className="er-sub">Equipment and technical requirements</h4>
            {equipmentItems.length > 0 && (
            <ul className="er-requested">
              {equipmentItems.map((item, index) => (
                <li key={`${item.item}-${index}`}>
                  <span>{item.item}</span>
                  <span className="er-qty">Requested: {item.quantity}</span>
                </li>
              ))}
            </ul>
            )}
            {(equipmentNotes || request.technical_support_required || technicalSupportDetails ||
              request.video_conferencing_required || technicalSpecifications) && (
              <dl className="er-requirements">
                {equipmentNotes && <><dt>Equipment notes</dt><dd>{equipmentNotes}</dd></>}
                {request.technical_support_required && <><dt>Technical support</dt><dd>Required</dd></>}
                {technicalSupportDetails && <><dt>Technical support details</dt><dd>{technicalSupportDetails}</dd></>}
                {request.video_conferencing_required && <><dt>Video conferencing</dt><dd>Required</dd></>}
                {technicalSpecifications && <><dt>Technical specifications</dt><dd>{technicalSpecifications}</dd></>}
              </dl>
            )}
          </section>
        )}

        <fieldset className="er-extra">
          <legend>Additional equipment from other request details (optional)</legend>
          {additionalItems.map((item, index) => (
            <div className="er-extra-row" key={index}>
              <label className="er-field">
                Name
                <input
                  aria-label={`Additional equipment name ${index + 1}`}
                  type="text"
                  maxLength="255"
                  value={item.item}
                  onChange={event => updateAdditionalItem(index, { item: event.target.value })}
                  disabled={saving || loading}
                />
              </label>
              <label className="er-field">
                Quantity
                <input
                  aria-label={`Additional equipment quantity ${index + 1}`}
                  type="number"
                  min="1"
                  max="10000"
                  value={item.quantity}
                  onChange={event => updateAdditionalItem(index, { quantity: Number(event.target.value) || 1 })}
                  disabled={saving || loading}
                />
              </label>
              <button type="button" className="er-icon-btn er-icon-btn--danger" aria-label="Remove additional equipment" title="Remove additional equipment" onClick={() => removeAdditionalItem(index)} disabled={saving || loading}>
                <TrashIcon />
              </button>
            </div>
          ))}
          <button type="button" className="er-icon-btn er-extra-add" aria-label="Add additional equipment" title="Add additional equipment" onClick={addAdditionalItem} disabled={saving || loading || additionalItems.length >= 50}>
            <PlusIcon />
          </button>
        </fieldset>

        {!availability && (
          <div className="er-actions">
            <button type="button" className="er-btn" onClick={checkAvailability} disabled={loading}>{loading ? 'Checking…' : 'Check availability'}</button>
          </div>
        )}
        {error && <p className="er-error" role="alert">{error}</p>}

        {availability && (
          <form className="er-avail" onSubmit={reserve}>
            <h4 className="er-sub">Matching assets for this event slot</h4>
            {availability.items.map(item => {
              const badge = availabilityBadge(item);
              return (
                <fieldset className="er-item" key={item.item}>
                  <legend>
                    <span className="er-item-head">
                      <span className="er-item-name">{item.item}</span>
                      <span>
                        <span className="er-item-count">{item.availableQuantity} of {item.requestedQuantity} requested available </span>
                        <span className={`er-badge ${badge.tone}`}>{badge.label}</span>
                      </span>
                    </span>
                  </legend>
                  {item.availableAssets.length === 0 ? (
                    <p className="er-empty-note">No matching operational asset is available for this date and time. The seeded availability calendar covers 12–16 October 2026; check the equipment info tab for supported asset types and time windows.</p>
                  ) : (
                    item.availableAssets.map(asset => {
                      const allocatedElsewhere = item.availableAssets.reduce((total, candidate) => (
                        candidate.id === asset.id ? total : total + (Number(selectedQuantities[candidate.id]) || 0)
                      ), 0);
                      const maxSelectable = Math.min(
                        asset.available_quantity,
                        Math.max(0, item.requestedQuantity - allocatedElsewhere),
                      );
                      return (
                        <label className="er-asset" key={asset.id}>
                          <span className="er-asset-info">
                            <span className="er-asset-code">{asset.asset_code} — {asset.name}</span>
                            <span className="er-asset-spec">{asset.specification || 'Specification not recorded'}</span>
                          </span>
                          <span className="er-stepper">
                            <input
                              aria-label={`Quantity of ${asset.asset_code} to reserve`}
                              type="number"
                              min="0"
                              max={maxSelectable}
                              value={selectedQuantities[asset.id] || 0}
                              onChange={event => updateQuantity(
                                asset.id,
                                Math.min(maxSelectable, Math.max(0, Number(event.target.value) || 0)),
                              )}
                              disabled={saving}
                            />
                            <small>{asset.available_quantity} available</small>
                          </span>
                        </label>
                      );
                    })
                  )}
                </fieldset>
              );
            })}
            <div className="er-actions">
              {request.review_outcome === 'fully_fulfillable' && !meetsFullRequest &&
                <p className="er-status" role="status">Select all requested units before confirming this full reservation.</p>}
              <button type="submit" className="er-btn" disabled={saving || loading || !canReserve}>
                {saving ? 'Reserving…' : totalSelected ? `Confirm reservation (${totalSelected} ${totalSelected === 1 ? 'unit' : 'units'})` : 'Confirm reservation'}
              </button>
              <button type="button" className="er-btn er-btn--quiet" onClick={checkAvailability} disabled={saving || loading}>Refresh availability</button>
            </div>
          </form>
        )}
      </div>
    </article>
  );
}

/**
 * Presents reviewed requests awaiting asset allocation and confirmed reservation audit details.
 */
export default function EquipmentReservationSection({
  requests, reservations, token, onReserved, error, onGoToReviews,
}) {
  return (
    <div className="er-root">
      <style>{STYLES}</style>
      <section className="er-section" aria-labelledby="equipment-reservation-heading">
        <h2 className="er-section-title" id="equipment-reservation-heading">Equipment Reservation</h2> 
        <br></br>
        {error && <p className="er-error" role="alert">{error}</p>}
        {requests.length === 0 ? (
          <div className="er-empty">
            <h3>No reviewed equipment requests yet</h3>
            <p>Requests appear here once they have been reviewed.</p>
            <button type="button" className="er-btn" onClick={onGoToReviews}>Go to equipment request review</button>
          </div>
        ) : (
          <div className="er-grid">
            {requests.map(request => (
              <ReservationCandidate key={request.id} request={request} token={token} onReserved={onReserved} />
            ))}
          </div>
        )}
      </section>

      <section className="er-section" aria-labelledby="confirmed-reservations-heading">
        <h2 className="er-section-title" id="confirmed-reservations-heading">Equipment Reservations</h2>
        {error && reservations.length === 0 && <p className="er-error">Reservations could not be loaded.</p>}
        {reservations.length === 0 ? <p className="er-section-hint">No upcoming equipment reservations.</p> : (
          <div className="er-table-wrap">
            <table className="er-table">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Date and time</th>
                  <th scope="col">Venue</th>
                  <th scope="col">Equipment</th>
                  <th scope="col">Reserved at</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map(reservation => (
                  <tr key={reservation.id}>
                    <th scope="row">{reservation.event_name}</th>
                    <td>
                      {formatDate(reservation.event_date)}
                      <span className="er-cell-sub">{formatTime(reservation.start_time)}–{formatTime(reservation.end_time)}</span>
                    </td>
                    <td>{reservation.venue_name || 'Venue not confirmed'}</td>
                    <td>
                      <div className="er-chip-list">
                        {reservation.items.map(item => (
                          <div className="er-chip" key={item.assetCode}>
                            {item.assetCode} — {item.name} (×{item.quantity})
                            <span className="er-cell-sub">Specification: {item.specification || 'Not recorded'}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>{new Date(reservation.reserved_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}