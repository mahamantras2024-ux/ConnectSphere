// File: Displays the Technical Support dashboard and its authenticated pending equipment-review queue.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import PageIntro from '../../components/PageIntro';
import { useAuth } from '../../context/AuthContext';
import EquipmentInventorySection from './EquipmentInventorySection';
import EquipmentReservationSection from './EquipmentReservationSection';

const outcomes = [
  ['fully_fulfillable', 'Fully fulfillable'],
  ['partially_fulfillable', 'Partially fulfillable'],
  ['not_fulfillable', 'Not fulfillable'],
];

/**
 * Renders one submitted equipment request and records the staff member's fulfillment decision.
 * Partial and unavailable decisions require a reason; submitted requirements stay read-only.
 */
function EquipmentRequestCard({ request, onReview }) {
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const items = Array.isArray(request.equipment_items) ? request.equipment_items : [];
  const date = request.proposed_date
    ? new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${request.proposed_date}T00:00:00Z`))
    : 'Not provided';

  async function submitReview(event) {
    event.preventDefault();
    const goToReservations = event.nativeEvent.submitter?.value === 'save-and-reserve';
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
      await onReview(request, outcome, cleanReason || undefined, goToReservations);
    } catch (saveError) {
      setError(saveError.message || 'Unable to save this review.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="record-card" aria-labelledby={`equipment-request-${request.id}`}>
      <h2 id={`equipment-request-${request.id}`}>{request.name}</h2>
      <dl className="detail-facts">
        <div><dt>Event date</dt><dd>{date}</dd></div>
        <div><dt>Event time</dt><dd>{request.proposed_start_time?.slice(0, 5) || 'Not provided'} – {request.proposed_end_time?.slice(0, 5) || 'Not provided'}</dd></div>
        <div>
          <dt>Venue</dt>
          <dd><span>{request.venue_name || 'Not assigned'}</span>{request.venue_location && <span> · {request.venue_location}</span>}</dd>
        </div>
      </dl>

      <section aria-label="Equipment and technical requirements">
        <h3>Requested equipment</h3>
        {items.length ? (
          <ul>{items.map((entry, index) => <li key={`${entry.item}-${index}`}>{entry.item} — quantity: {entry.quantity}</li>)}</ul>
        ) : <p>No individual equipment items requested.</p>}
        <dl className="detail-facts">
          <div><dt>Other equipment notes</dt><dd>{request.equipment_notes || 'Not provided'}</dd></div>
          <div><dt>Technical support required</dt><dd>{request.technical_support_required ? 'Yes' : 'No'}</dd></div>
          <div><dt>Technical support details</dt><dd>{request.technical_support_details || 'Not provided'}</dd></div>
          <div><dt>Video conferencing required</dt><dd>{request.video_conferencing_required ? 'Yes' : 'No'}</dd></div>
          <div><dt>Technical specifications</dt><dd>{request.technical_specifications || 'Not provided'}</dd></div>
        </dl>
      </section>

      <form onSubmit={submitReview}>
        <h3>Review fulfillment</h3>
        <label>
          Fulfillment decision
          <select
            aria-label="Fulfillment decision"
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
            value={reason}
            onChange={event => { setReason(event.target.value); setError(''); }}
            disabled={saving}
            required={Boolean(outcome && outcome !== 'fully_fulfillable')}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" name="action" value="save" disabled={saving}>
          {saving ? 'Saving review…' : 'Save review'}
        </button>
        <button
          type="submit"
          name="action"
          value="save-and-reserve"
          className="button-secondary"
          disabled={saving}
        >
          Save review &amp; go to equipment reservation
        </button>
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
  const [error, setError] = useState('');
  const [inventoryError, setInventoryError] = useState('');
  const [reservationError, setReservationError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState('inventory');

  async function loadDashboardData() {
    setLoading(true);
    setError('');
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
      setError(requestResult.reason.message || 'Unable to load equipment requests.');
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

  async function saveReview(request, outcome, reason, goToReservations = false) {
    await api.post(`/events/${request.id}/equipment-reviews`, {
      outcome,
      ...(reason ? { reason } : {}),
      requestVersion: request.request_version,
    }, token);
    setRequests(current => current.filter(pending => pending.id !== request.id));
    setNotice(`Review saved for ${request.name}.`);
    await loadDashboardData();
    if (goToReservations) setActiveTab('reservations');
  }

  async function handleReservationConfirmed(reservation) {
    await loadDashboardData();
    setNotice(`Equipment reservation confirmed for ${reservation.event_name}.`);
  }

  const tabs = [
    { id: 'inventory', label: 'Equipment info' },
    { id: 'review', label: 'Equipment request review' },
    { id: 'reservations', label: 'Equipment reservation' },
  ];

  return (
    <div className="page">
      <PageIntro
        title="Technical Support Dashboard"
        eyebrow="Internal workspace"
        description="Review equipment, assess event requests, and reserve suitable assets."
      />
      {notice && <p role="status" className="support-dashboard-notice">{notice}</p>}
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
            {error && <p role="alert">{error}</p>}
            {loading ? <p>Loading equipment requests…</p> : requests.length === 0
              ? <p>No pending equipment requests.</p>
              : <div className="record-grid">
                {requests.map(request => (
                  <EquipmentRequestCard
                    key={request.id}
                    request={request}
                    onReview={saveReview}
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
