// File: Lets Venue Staff inspect and decide pending bookings without leaving their catalogue.
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Modal from '../../components/Modal';
import useLiveResource from '../../hooks/useLiveResource';

/** Formats the requested period and audit time in Singapore, independent of the staff member's device timezone. */
function singaporeTime(value) {
  return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short', hour12: false });
}

/** The capacity, layout and accessibility a booking was first requested with ('' when its snapshot recorded none). */
function originalText({ capacity, layout, accessibility } = {}) {
  return [capacity != null && `${capacity} guests`, layout && `${layout} layout`, accessibility?.length && `accessibility: ${accessibility.join(', ')}`]
    .filter(Boolean).join('; ');
}

/** Shows the staff-only queue and notifies related dashboard views after a persisted decision. */
export default function VenueBookingInbox() {
  const { token } = useAuth();
  const { data, loading, error, updateData, refresh } = useLiveResource('/venues/requests/pending', token);
  const [selectedId, setSelectedId] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState('');
  const requests = data?.requests || [];
  // Derive the drawer from authorized live rows so a removed request or lost permission cannot leave stale private details open.
  const selected = requests.find(request => request.id === selectedId);
  useEffect(() => { setSelectedId(null); setReason(''); setFailure(''); setMessage(''); }, [token]);
  /** Fresh selection clears feedback from another request so staff cannot accidentally reuse a rejection reason. */
  function review(request) {
    setSelectedId(request.id); setReason(''); setFailure(''); setMessage('');
    // Date controls represent Singapore wall time; never inherit the computer's locale offset.
    setExpiry(request.status==='tentative' ? new Date(Date.parse(request.hold_expires_at)+8*3600000).toISOString().slice(0,16) : '');
  }
  /**
   * Only a successful server decision removes the queue item; errors keep the staff member's notes for retry. A booking an
   * applied amendment flagged (Record Offline Clarifications AC5) is already confirmed, so it is re-confirmed or rejected
   * through its re-check, without a hold expiry.
   */
  async function decide(decision) {
    const flagged = Boolean(selected.recheck_required_at);
    const updating=decision==='expiry';
    let holdExpiresAt;
    if(!flagged && (decision==='approved' || updating)) {
      const instant=Date.parse(`${expiry}:00+08:00`);
      if(!Number.isFinite(instant) || instant<=Date.now()) {setFailure('Choose a specific future hold expiry date and time.');return;}
      holdExpiresAt=new Date(instant).toISOString();
    }
    setSaving(true); setFailure('');
    try {
      const path = flagged ? 'recheck' : updating ? 'expiry' : 'decision';
      const body = flagged ? { decision: decision === 'approved' ? 'confirmed' : decision, reason }
        : updating ? {holdExpiresAt} : { decision, reason, ...(holdExpiresAt?{holdExpiresAt}:{}) };
      const result = await api.put(`/venues/${selected.venue_id}/requests/${selected.id}/${path}`, body, token);
      // Live holds remain in the staff queue so their deadlines can be managed without repeating approval.
      updateData(current => current && ({ ...current, requests: result.request.status==='tentative'
        ? current.requests.map(request=>request.id===selected.id?{...request,...result.request}:request)
        : current.requests.filter(request => request.id !== selected.id) }));
      window.dispatchEvent(new Event('venue-booking-decision'));
      const outcome = flagged ? (result.request.status === 'approved' ? 'Re-confirmed' : 'Rejected')
        : result.request.status === 'tentative' ? 'Tentative hold '+(updating?'updated':'approved') : 'Rejected';
      setMessage(`${outcome}: ${selected.event_name} at ${selected.venue_name}. Recorded by staff #${result.request.decision_by} on ${singaporeTime(result.request.updated_at)}.`);
      setSelectedId(null);
    } catch (err) { setFailure(err.message); }
    finally { setSaving(false); }
  }
  return <section className="booking-inbox" aria-labelledby="booking-inbox-title">
    <div className="section-heading"><div><p className="eyebrow">Venue arrangements</p><h2 id="booking-inbox-title">Pending venue booking requests</h2></div>
      <button className="button-secondary" onClick={refresh}>Refresh requests</button></div>
    {message && <p role="status" className="booking-decision-success">{message}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {loading ? <p role="status">Loading booking requests…</p> : data && (!requests.length ? <p>No pending venue booking requests.</p>
      : <div className="record-grid">{requests.map(request => <article className="record-card" key={request.id}>
        <span className="status-badge">{request.recheck_required_at ? 'Re-check required' : request.status==='tentative'?'Tentative hold':'Pending'}</span><h3>{request.event_name}</h3><p>{request.venue_name}</p>
        {request.requirements?.sessionName && <p className="eyebrow">Session: {request.requirements.sessionName}</p>}
        {request.status==='tentative' && <p>Expires {singaporeTime(request.hold_expires_at)} (SGT)</p>}
        <p>{singaporeTime(request.start_datetime)} – {singaporeTime(request.end_datetime)}</p>
        <button className="button-secondary" aria-label={`Review ${request.event_name} at ${request.venue_name}`} onClick={() => review(request)}>Review request</button>
      </article>)}</div>)}
    {selected && <Modal drawer title="Review venue booking request" onClose={() => { if (!saving) setSelectedId(null); }}>
      <div className="booking-review"><p className="eyebrow">Booking request #{selected.id}</p><h2>{selected.event_name}</h2>
        {selected.requirements?.sessionName && <p>Session: {selected.requirements.sessionName}</p>}
        <dl className="detail-facts"><div><dt>Venue</dt><dd>{selected.venue_name}</dd></div>
          <div><dt>Start (Singapore time)</dt><dd>{singaporeTime(selected.start_datetime)}</dd></div>
          <div><dt>End (Singapore time)</dt><dd>{singaporeTime(selected.end_datetime)}</dd></div>
          <div><dt>Expected attendance</dt><dd>{selected.expected_attendance ?? 'Not specified'}</dd></div>
          <div><dt>Room layout</dt><dd>{selected.room_layout_preference || 'Not specified'}</dd></div>
          <div><dt>Accessibility</dt><dd>{selected.accessibility_requirements?.join(', ') || 'None recorded'}</dd></div></dl>
        {selected.recheck_required_at && <p className="detail-note"><strong>Re-check required:</strong> {selected.recheck_reason}</p>}
        {/* Keep the submitted snapshot available when staff review an amendment's impact on this booking. */}
        {originalText(selected.original_requirements) && <p className="detail-note"><strong>Originally requested:</strong> {originalText(selected.original_requirements)}</p>}
        {!selected.recheck_required_at && <div className="field"><label htmlFor="venue-hold-expiry">Hold expiry (Singapore time)</label><input id="venue-hold-expiry" type="datetime-local" value={expiry} onChange={event=>setExpiry(event.target.value)} disabled={saving} aria-describedby="venue-hold-expiry-help"/><span id="venue-hold-expiry-help" className="field-help">Required for approval. The Coordinator must confirm before this deadline.</span></div>}
        {selected.status!=='tentative' && <label>Reason or alternative arrangement (optional)<textarea value={reason} onChange={event => setReason(event.target.value)} disabled={saving} rows={4} /></label>}
        <p className="detail-note">{selected.recheck_required_at ? 'Re-confirming keeps the confirmed booking; rejecting ends it. The Coordinator is told either way.'
          : 'Approval creates a tentative hold and rechecks availability. The Coordinator receives the deadline.'}</p>
        {failure && <p role="alert" className="error-message">{failure}</p>}
        <div className="booking-review-actions">{selected.recheck_required_at
          ? <><button className="button-primary" disabled={saving} onClick={() => decide('approved')}>Re-confirm booking</button>
          <button className="button-secondary" disabled={saving} onClick={() => decide('rejected')}>Reject booking</button></>
          : selected.status==='tentative'
          ? <button className="button-primary" disabled={saving} onClick={()=>decide('expiry')}>Save expiry</button>
          : <><button className="button-primary" disabled={saving} onClick={() => decide('approved')}>Approve request</button>
          <button className="button-secondary" disabled={saving} onClick={() => decide('rejected')}>Reject request</button></>}</div>
      </div></Modal>}
  </section>;
}
