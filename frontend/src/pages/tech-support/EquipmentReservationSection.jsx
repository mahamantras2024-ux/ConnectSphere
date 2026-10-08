// File: Checks matching asset availability and confirms event-specific reservations.
import { useState } from 'react';
import { api } from '../../api/client';

const formatDate = value => value
  ? new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`))
  : 'Not provided';
const formatTime = value => value?.slice(0, 5) || 'Not provided';
const normaliseItemName = value => String(value).trim().toLocaleLowerCase();

function containsRequestedQuantities(items, selectedSelections) {
  const requestedCounts = new Map();
  for (const item of items) {
    const key = normaliseItemName(item.item);
    requestedCounts.set(key, (requestedCounts.get(key) || 0) + item.requestedQuantity);
  }
  const selectedCounts = new Map();
  for (const { asset, quantity } of selectedSelections) {
    const key = normaliseItemName(asset.name);
    selectedCounts.set(key, (selectedCounts.get(key) || 0) + quantity);
  }
  return [...requestedCounts].every(([name, quantity]) => selectedCounts.get(name) === quantity);
}

/**
 * Lets staff allocate available stock quantities and confirms them atomically.
 * Full reviews require every requested unit; partial reviews may reserve any non-empty subset.
 */
function ReservationCandidate({ request, token, onReserved }) {
  const [availability, setAvailability] = useState(null);
  const [selectedQuantities, setSelectedQuantities] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function checkAvailability() {
    setLoading(true);
    setError('');
    setAvailability(null);
    try {
      const data = await api.get(`/events/${request.id}/equipment-availability`, token);
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

  async function reserve(event) {
    event.preventDefault();
    const selectedSelections = availability.items.flatMap(item => item.availableAssets)
      .map(asset => ({ asset, quantity: Number(selectedQuantities[asset.id]) || 0 }))
      .filter(selection => selection.quantity > 0);
    const fulfillsAllRequests = containsRequestedQuantities(availability.items, selectedSelections);
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
      const data = await api.post(`/events/${request.id}/equipment-reservations`, {
        selections: selectedSelections.map(({ asset, quantity }) => ({ inventoryId: asset.id, quantity })),
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
  const meetsFullRequest = availability && containsRequestedQuantities(availability.items, selectedSelections);
  const canReserve = selectedSelections.length > 0 &&
    (request.review_outcome !== 'fully_fulfillable' || meetsFullRequest);

  return (
    <article className="record-card" aria-labelledby={`reservation-candidate-${request.id}`}>
      <h3 id={`reservation-candidate-${request.id}`}>{request.name}</h3>
      <p>{formatDate(request.proposed_date)} · {formatTime(request.proposed_start_time)}–{formatTime(request.proposed_end_time)}</p>
      <p>Venue: {request.venue_name || 'Not confirmed'}{request.venue_location ? ` · ${request.venue_location}` : ''}</p>
      <p>Review: {request.review_outcome.replaceAll('_', ' ')}{request.review_reason ? ` — ${request.review_reason}` : ''}</p>
      {!availability && <button type="button" onClick={checkAvailability} disabled={loading}>{loading ? 'Checking…' : 'Check availability'}</button>}
      {error && <p role="alert">{error}</p>}
      {availability && (
        <form onSubmit={reserve}>
          <h4>Matching assets for this event slot</h4>
          {availability.items.map(item => (
            <fieldset key={item.item}>
              <legend>{item.item}: {item.availableQuantity} available (requested {item.requestedQuantity})</legend>
              {item.availableAssets.length === 0 ? (
                <p>No matching operational asset is available for this date and time. The seeded availability calendar covers 12–16 October 2026; check the equipment info tab for supported asset types and time windows.</p>
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
                    <label key={asset.id}>
                      {asset.asset_code} — {asset.name}: {asset.specification}
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
                    </label>
                  );
                })
              )}
            </fieldset>
          ))}
          {request.review_outcome === 'fully_fulfillable' && !meetsFullRequest &&
            <p role="status">Select all requested units before confirming this full reservation.</p>}
          <button type="submit" disabled={saving || loading || !canReserve}>
            {saving ? 'Reserving…' : 'Confirm reservation'}
          </button>
          <button type="button" className="button-secondary" onClick={checkAvailability} disabled={saving || loading}>Refresh availability</button>
        </form>
      )}
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
    <>
      <section aria-labelledby="equipment-reservation-heading">
        <div className="section-heading"><h2 id="equipment-reservation-heading">Equipment availability and reservation</h2></div>
        <p>Check the seeded catalogue for each reviewed event slot, then reserve specific available assets.</p>
        {error && <p role="alert">{error}</p>}
        {requests.length === 0 ? (
          <div className="empty-state">
            <h3>No equipment requests are ready to reserve</h3>
            <p>A request appears here after it has an itemized equipment list and is reviewed as fully or partially fulfillable. Requests recorded only in free-text notes cannot be matched to individual assets.</p>
            <button type="button" className="button-secondary" onClick={onGoToReviews}>Go to equipment request review</button>
          </div>
        ) : (
          <div className="record-grid">
            {requests.map(request => (
              <ReservationCandidate key={request.id} request={request} token={token} onReserved={onReserved} />
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="confirmed-reservations-heading">
        <div className="section-heading"><h2 id="confirmed-reservations-heading">Confirmed reservations</h2></div>
        {error && reservations.length === 0 && <p>Reservations could not be loaded.</p>}
        {reservations.length === 0 ? <p>No upcoming equipment reservations.</p> : (
          <ul>
            {reservations.map(reservation => (
              <li key={reservation.id}>
                <strong>{reservation.event_name}</strong>
                {' — '}{formatDate(reservation.event_date)} {formatTime(reservation.start_time)}–{formatTime(reservation.end_time)}
                {' — '}{reservation.venue_name || 'Venue not confirmed'}
                {reservation.items.map(item => (
                  <span key={item.assetCode}> · {item.assetCode} — {item.name} (×{item.quantity})</span>
                ))}
                <small> Reserved by {reservation.reserved_by_name} at {new Date(reservation.reserved_at).toLocaleString()}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
