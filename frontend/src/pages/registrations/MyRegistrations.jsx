// File: Displays personal registration summaries and confirmed withdrawal actions for the authenticated attendee.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import useRegistrationResource from './useRegistrationResource';
import { registrationStatusLabel } from './registrationStatusLabel';
import PageIntro from '../../components/PageIntro';
import Modal from '../../components/Modal';
import WithdrawRegistrationAction from './WithdrawRegistrationAction';
const publicStatusLabels = { confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
// Loads personal registrations and presents only attendee-safe event statuses; standalone navigation returns to the attendee homepage.
export default function MyRegistrations({ dashboard = false }) {
  const { token } = useAuth();
  const [selectedId, setSelectedId] = useState(null);
  const { data, loading, error, updateData } = useRegistrationResource('/registrations/mine', token);
  const registrations = data?.registrations || [];
  // Derive the drawer from the live records, avoiding a stale copy after promotion, withdrawal or cancellation.
  const selected = registrations.find(record => record.id === selectedId);
  /** Applies the persisted status to both the visible card and open drawer without waiting for a page reload. */
  function handleWithdrawal(updated) {
    updateData(current => ({ ...current, registrations: current.registrations.map(record => record.id === updated.id ? { ...record, ...updated } : record) }));
  }
  return <div className="page">
    {/* Only the standalone page needs a return link; the dashboard already is the attendee homepage. */}
    {!dashboard && <Link className="button-link button-secondary" to="/attendee/dashboard">Back to events</Link>}
    <PageIntro title={dashboard ? 'Attendee Dashboard' : 'My registrations'} eyebrow="Your event journey" description="Keep track of your existing registrations and their status." />
    {dashboard && <div className="section-heading"><h2>My registrations</h2></div>}
    {error && <p role="alert" className="error-message">{error}{data && ' Showing the last loaded registration information.'}</p>}
    {loading ? <p role="status" className="loading-state">Loading registrations...</p> : !data && error ? null : !registrations.length ? <section className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>No registrations yet</h2><p>You haven't registered for any events yet.</p></section> : <div className="record-grid">{registrations.map(record =>
      // Converts each record into its displayed or submitted representation.
      <article className="record-card" key={record.id}>
        <div className="record-top"><span className="record-number">EVENT / {record.event_id}</span><span className="status-badge">{registrationStatusLabel(record.status, record.event_status)}</span></div>
        <h2>{record.event_name || `Event #${record.event_id}`}</h2>
        <p>{record.proposed_date || 'Date not specified'}{record.proposed_start_time && ` · ${record.proposed_start_time.slice(0, 5)}`}</p>
        <p><strong>Event status:</strong> {publicStatusLabels[record.event_status] || 'Status unavailable'}</p>
        <button className="button-secondary record-action" onClick={() => setSelectedId(record.id)}>View registration <span aria-hidden="true">↗</span></button>
      </article>)}</div>}
    {selected && <Modal drawer title="Registration details" onClose={() => setSelectedId(null)}><div className="registration-detail"><p className="eyebrow">Your registration / {selected.id}</p><h1>{selected.event_name || `Event #${selected.event_id}`}</h1><dl className="detail-facts"><div><dt>Registration status</dt><dd>{registrationStatusLabel(selected.status, selected.event_status)}</dd></div><div><dt>Event status</dt><dd>{publicStatusLabels[selected.event_status] || 'Status unavailable'}</dd></div><div><dt>Event date</dt><dd>{selected.proposed_date || 'Date not specified'}</dd></div><div><dt>Start time</dt><dd>{selected.proposed_start_time?.slice(0, 5) || 'Not specified'}</dd></div></dl>
      {selected.event_status && <Link className="button-link button-secondary" to={`/attendee/events/${selected.event_id}`}>View current event details</Link>}
      <WithdrawRegistrationAction registration={selected} onWithdrawn={handleWithdrawal} />
      <p className="detail-note">This is your personal registration summary.</p></div></Modal>}
  </div>;
}
