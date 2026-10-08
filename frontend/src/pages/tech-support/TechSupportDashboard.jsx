// File: Displays the Technical Support dashboard and its authenticated pending equipment-review queue.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import PageIntro from '../../components/PageIntro';
import { useAuth } from '../../context/AuthContext';
import EquipmentInventorySection from './EquipmentInventorySection';
import EquipmentReservationSection from './EquipmentReservationSection';

// Styles for the equipment request review cards only; tabs and other sections keep their existing styling.
const dashboardStyles = `
.support-muted { color: #5b6470; }
.support-error { color: #a12626; margin: 0; }
.support-empty {
  padding: 2rem 1rem;
  border: 1px dashed var(--border, #c4cad3);
  border-radius: 8px;
  text-align: center;
}
.support-empty p { margin: 0.25rem 0; }

/* Request card: few blocks, one text size, generous spacing */
.support-request {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  height: 100%;
  box-sizing: border-box;
  font-size: 0.95rem;
}
.support-request > h2 {
  margin: 0;
  font-size: 1.2rem;
  line-height: 1.3;
}
.support-request h3 {
  margin: 0 0 0.4rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #5b6470;
}

/* Key facts: label on the left, value on the right, one line each */
.support-facts { margin: 0; display: grid; gap: 0.35rem; }
.support-facts > div {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr);
  gap: 0.75rem;
}
.support-facts dt { color: #5b6470; }
.support-facts dd { margin: 0; font-size: inherit; font-weight: 500; overflow-wrap: anywhere; }

/* Equipment */
.support-request-section {
  padding-top: 1.1rem;
  border-top: 1px solid var(--border, #e3e6eb);
  display: grid;
  gap: 0.75rem;
}
.support-request-section > div h3 + * { margin-top: 0; }
.support-items { list-style: none; margin: 0; padding: 0; }
.support-items li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.35rem 0;
}
.support-items li + li { border-top: 1px solid var(--border, #eceef2); }
.support-qty { font-variant-numeric: tabular-nums; font-weight: 600; }
.support-text { margin: 0; line-height: 1.5; }

.support-flags { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.support-flag {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: #e6efff;
  color: #17408a;
  font-size: 0.8rem;
}

/* Review form pinned to the bottom so cards in a row line up */
.support-review-form {
  display: grid;
  gap: 0.85rem;
  margin-top: auto;
  padding-top: 1.1rem;
  border-top: 1px solid var(--border, #e3e6eb);
}
.support-review-form h3 { margin: 0; }
.support-review-form label { display: grid; gap: 0.3rem; font-weight: 500; }
.support-review-form select,
.support-review-form textarea { width: 100%; font: inherit; box-sizing: border-box; }
.support-review-form textarea { resize: vertical; }
.support-form-actions { display: flex; justify-content: center; }

/* Pop-up notification */
.support-toast {
  position: fixed;
  top: 1.25rem;
  right: 1.25rem;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: min(24rem, calc(100vw - 2.5rem));
  padding: 0.8rem 1rem;
  border: 2px solid;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  cursor: pointer;
  animation: support-toast-in 0.2s ease-out;
}
.support-toast p { margin: 0; }
.support-toast.is-success { border-color: #8fd3a8; color: #1c4d31; }
.support-toast.is-error { border-color: #d64545; color: #8a1f1f; }
.support-toast-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1;
}
.is-success .support-toast-icon { background: #2e9d5b; }
.is-error .support-toast-icon { background: #d64545; }
@keyframes support-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .support-toast { animation: none; }
}

@media (max-width: 600px) {
  .support-form-actions button { width: 100%; }
}
`;

const outcomes = [
  ['fully_fulfillable', 'Fully fulfillable'],
  ['partially_fulfillable', 'Partially fulfillable'],
  ['not_fulfillable', 'Not fulfillable'],
];

const dateFormatter = new Intl.DateTimeFormat('en-SG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Renders one submitted equipment request and records the staff member's fulfillment decision.
 * Partial and unavailable decisions require a reason; submitted requirements stay read-only.
 */
function EquipmentRequestCard({ request, onReview, onError }) {
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const items = Array.isArray(request.equipment_items) ? request.equipment_items : [];
  const reasonRequired = Boolean(outcome && outcome !== 'fully_fulfillable');
  const date = request.proposed_date
    ? dateFormatter.format(new Date(`${request.proposed_date}T00:00:00Z`))
    : 'Date not provided';
  const start = request.proposed_start_time?.slice(0, 5);
  const end = request.proposed_end_time?.slice(0, 5);
  const time = start || end ? `${start || '—'} – ${end || '—'}` : 'Time not provided';
  const headingId = `equipment-request-${request.id}`;
  const errorId = `equipment-error-${request.id}`;

  async function submitReview(event) {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (!outcome) {
      setError('Select a fulfillment decision.');
      return;
    }
    if (outcome !== 'fully_fulfillable' && !cleanReason) {
      setError('Enter a reason for this decision.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      await onReview(request, outcome, cleanReason || undefined);
    } catch (saveError) {
      onError(saveError.message || 'Unable to save this review.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="record-card support-request" aria-labelledby={headingId}>
      <h2 id={headingId}>{request.name}</h2>

      <dl className="support-facts">
        <div><dt>Date</dt><dd>{date}</dd></div>
        <div><dt>Time</dt><dd>{time}</dd></div>
        <div>
          <dt>Venue</dt>
          <dd>
            {request.venue_name || 'Not assigned'}
            {request.venue_location && <span className="support-muted"> · {request.venue_location}</span>}
          </dd>
        </div>
      </dl>

      <section className="support-request-section" aria-label="Equipment and technical requirements">
        {items.length > 0 && (
          <div>
            <h3>Requested equipment</h3>
            <ul className="support-items">
              {items.map((entry, index) => (
                <li key={`${entry.item}-${index}`}>
                  <span>{entry.item}</span>
                  <span className="support-qty" aria-label={`Quantity ${entry.quantity}`}>×{entry.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {request.equipment_notes && (
          <div>
            <h3>{items.length ? 'Other equipment notes' : 'Requested equipment'}</h3>
            <p className="support-text">{request.equipment_notes}</p>
          </div>
        )}
        {!items.length && !request.equipment_notes && (
          <p className="support-muted support-text">No equipment requested.</p>
        )}
        {(request.technical_support_required || request.video_conferencing_required) && (
          <div className="support-flags">
            {request.technical_support_required && <span className="support-flag">Technical support required</span>}
            {request.video_conferencing_required && <span className="support-flag">Video conferencing required</span>}
          </div>
        )}
        {request.technical_support_details && (
          <div><h3>Technical support details</h3><p className="support-text">{request.technical_support_details}</p></div>
        )}
        {request.technical_specifications && (
          <div><h3>Technical specifications</h3><p className="support-text">{request.technical_specifications}</p></div>
        )}
      </section>

      <form className="support-review-form" onSubmit={submitReview} noValidate>
        <h3>Review fulfillment</h3>
        <label>
          Fulfillment decision
          <select
            aria-label="Fulfillment decision"
            aria-describedby={error ? errorId : undefined}
            value={outcome}
            onChange={event => { setOutcome(event.target.value); setError(''); }}
            disabled={saving}
            required
          >
            <option value="">Select a decision</option>
            {outcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Reason (required unless fully fulfillable)
          <textarea
            aria-label="Reason (required unless fully fulfillable)"
            rows={3}
            placeholder={reasonRequired ? 'Explain what can’t be provided and why' : 'Optional'}
            value={reason}
            onChange={event => { setReason(event.target.value); setError(''); }}
            disabled={saving}
            required={reasonRequired}
          />
        </label>
        {error && <p id={errorId} role="alert" className="support-error">{error}</p>}
        <div className="support-form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving review…' : 'Save review'}
          </button>
        </div>
      </form>
    </article>
  );
}


/**
 * Loads and presents pending equipment requests; successful reviews leave the pending queue.
 */
export default function TechSupportDashboard() {
  const { token } = useAuth();
  const [requests, setRequests] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [reservationRequests, setReservationRequests] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState('');
  const [reservationError, setReservationError] = useState('');
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('inventory');

  const showSuccess = message => setToast({ type: 'success', message });
  const showError = message => setToast({ type: 'error', message });

  async function loadDashboardData() {
    setLoading(true);
    setInventoryError('');
    setReservationError('');
    const [requestResult, inventoryResult, reservationResult] = await Promise.allSettled([
      api.get('/events/equipment-requests', token),
      api.get('/events/equipment-inventory', token),
      api.get('/events/equipment-reservations', token),
    ]);

    if (requestResult.status === 'fulfilled') {
      setRequests(requestResult.value.requests);
    } else {
      showError(requestResult.reason.message || 'Unable to load equipment requests.');
    }
    if (inventoryResult.status === 'fulfilled') {
      setInventory(inventoryResult.value.inventory);
    } else {
      setInventoryError(inventoryResult.reason.message || 'Unable to load the equipment catalogue.');
    }
    if (reservationResult.status === 'fulfilled') {
      setReservationRequests(reservationResult.value.requests);
      setReservations(reservationResult.value.reservations);
    } else {
      setReservationError(reservationResult.reason.message || 'Unable to load equipment reservations.');
    }
    setLoading(false);
  }

  useEffect(() => { loadDashboardData(); }, [token]);

  // Pop-up notifications dismiss themselves after a few seconds (errors stay a little longer).
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), toast.type === 'error' ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function saveReview(request, outcome, reason) {
    await api.post(`/events/${request.id}/equipment-reviews`, {
      outcome,
      ...(reason ? { reason } : {}),
      requestVersion: request.request_version,
    }, token);
    setRequests(current => current.filter(pending => pending.id !== request.id));
    showSuccess(`Review saved for ${request.name}.`);
    setActiveTab('reservations');
    await loadDashboardData();
  }

  async function handleReservationConfirmed(reservation) {
    await loadDashboardData();
    showSuccess(`Equipment reservation confirmed for ${reservation.event_name}.`);
  }

  const tabs = [
    { id: 'inventory', label: 'Equipment info' },
    { id: 'review', label: 'Equipment request review' },
    { id: 'reservations', label: 'Equipment reservation' },
  ];

  return (
    <div className="page">
      <style>{dashboardStyles}</style>
      <PageIntro
        title="Technical Support Dashboard"
        eyebrow="Internal workspace"
        description="Review equipment requests, and reserve equipment."
      />
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`support-toast is-${toast.type}`}
          title="Click to dismiss"
          onClick={() => setToast(null)}
        >
          <span className="support-toast-icon" aria-hidden="true">{toast.type === 'error' ? '✕' : '✓'}</span>
          <p>{toast.message}</p>
        </div>
      )}
      <div className="support-dashboard-tabs" role="tablist" aria-label="Technical Support dashboard sections">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`support-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`support-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={activeTab === tab.id ? 'support-dashboard-tab is-active' : 'support-dashboard-tab'}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={event => {
              const currentIndex = tabs.findIndex(currentTab => currentTab.id === tab.id);
              const nextIndex = event.key === 'ArrowRight'
                ? (currentIndex + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (currentIndex - 1 + tabs.length) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : -1;
              if (nextIndex >= 0) {
                event.preventDefault();
                const nextTab = tabs[nextIndex];
                setActiveTab(nextTab.id);
                document.getElementById(`support-tab-${nextTab.id}`)?.focus();
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'inventory' && (
        <div role="tabpanel" id="support-panel-inventory" aria-labelledby="support-tab-inventory">
          <EquipmentInventorySection inventory={inventory} error={inventoryError} />
        </div>
      )}
      {activeTab === 'review' && (
        <div role="tabpanel" id="support-panel-review" aria-labelledby="support-tab-review">
          <section aria-labelledby="pending-equipment-heading">
            <div className="section-heading">
              <h2 id="pending-equipment-heading">Pending equipment requests</h2>
              <button type="button" onClick={loadDashboardData} disabled={loading}>Refresh dashboard</button>
            </div>
            {loading ? <p className="support-muted">Loading equipment requests…</p> : requests.length === 0
              ? (
                <div className="support-empty">
                  <p><strong>You’re all caught up.</strong></p>
                  <p className="support-muted">New equipment requests will appear here once an event is submitted.</p>
                </div>
              )
              : <div className="record-grid">
                {requests.map(request => (
                  <EquipmentRequestCard
                    key={request.id}
                    request={request}
                    onReview={saveReview}
                    onError={showError}
                  />
                ))}
              </div>}
          </section>
        </div>
      )}
      {activeTab === 'reservations' && (
        <div role="tabpanel" id="support-panel-reservations" aria-labelledby="support-tab-reservations">
          <EquipmentReservationSection
            requests={reservationRequests}
            reservations={reservations}
            token={token}
            onReserved={handleReservationConfirmed}
            error={reservationError}
            onGoToReviews={() => setActiveTab('review')}
          />
        </div>
      )}
    </div>
  );
}