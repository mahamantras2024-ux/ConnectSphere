// File: Displays personal registration summaries and confirmed withdrawal actions for the authenticated attendee.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import PageIntro from '../../components/PageIntro';
import Modal from '../../components/Modal';
import WithdrawRegistrationAction from './WithdrawRegistrationAction';
const publicStatusLabels = { confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
// Loads personal registrations and presents only attendee-safe event statuses.
export default function MyRegistrations({ dashboard = false }) {
  const { token } = useAuth();
  const [selected, setSelected] = useState(null);
  const [registrations, setRegistrations] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    // Loads attendee-scoped records. A token change always unmounts this page (logout or role switch), and React 18
    // ignores updates after unmount, so no stale-response guard is needed.
    setLoading(true); setError('');
    api.get('/registrations/mine', token).then(data => setRegistrations(data.registrations || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);
  /** Applies the persisted status to both the visible card and open drawer without waiting for a page reload. */
  function handleWithdrawal(updated) {
    setRegistrations(current => current.map(record => record.id === updated.id ? { ...record, ...updated } : record));
    setSelected(current => ({ ...current, ...updated }));
  }
  return <div className="page"><PageIntro title={dashboard ? 'Attendee Dashboard' : 'My registrations'} eyebrow="Your event journey" description="Keep track of your existing registrations and their status." />
    {loading ? <p role="status" className="loading-state">Loading registrations...</p> : error ? <p role="alert" className="error-message">{error}</p> : !registrations.length ? <section className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>No registrations yet</h2><p>You haven't registered for any events yet.</p></section> : <div className="record-grid">{registrations.map(record =>
      // Converts each record into its displayed or submitted representation.
      <article className="record-card" key={record.id}>
        <div className="record-top"><span className="record-number">EVENT / {record.event_id}</span><span className="status-badge">{record.status}</span></div>
        <h2>{record.event_name || `Event #${record.event_id}`}</h2>
        <p>{record.proposed_date || 'Date not specified'}{record.proposed_start_time && ` · ${record.proposed_start_time.slice(0, 5)}`}</p>
        <p><strong>Event status:</strong> {publicStatusLabels[record.event_status] || 'Status unavailable'}</p>
        <button className="button-secondary record-action" onClick={() => setSelected(record)}>View registration <span aria-hidden="true">↗</span></button>
      </article>)}</div>}
    {selected && <Modal drawer title="Registration details" onClose={() => setSelected(null)}><div className="registration-detail"><p className="eyebrow">Your registration / {selected.id}</p><h1>{selected.event_name || `Event #${selected.event_id}`}</h1><dl className="detail-facts"><div><dt>Registration status</dt><dd>{selected.status || 'Not specified'}</dd></div><div><dt>Event status</dt><dd>{publicStatusLabels[selected.event_status] || 'Status unavailable'}</dd></div><div><dt>Event date</dt><dd>{selected.proposed_date || 'Date not specified'}</dd></div><div><dt>Start time</dt><dd>{selected.proposed_start_time?.slice(0, 5) || 'Not specified'}</dd></div></dl>
      {selected.event_status && <Link className="button-link button-secondary" to={`/attendee/events/${selected.event_id}`}>View current event details</Link>}
      <WithdrawRegistrationAction registration={selected} onWithdrawn={handleWithdrawal} />
      <p className="detail-note">This is your personal registration summary.</p></div></Modal>}
  </div>;
}
