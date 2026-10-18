// File: Presents affected equipment reservations and lets the assigned Coordinator decide replacement proposals.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

/** Lists replacement proposals for one assigned event and records the Coordinator's decision. */
export default function EquipmentReservationIssuesSection({ eventId, token }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingProposalId, setSavingProposalId] = useState(null);

  async function loadIssues() {
    setError('');
    try {
      const result = await api.get(`/events/${eventId}/equipment-reservation-issues`, token);
      if (!Array.isArray(result?.affectedReservations) ||
          result.affectedReservations.some(issue => !Array.isArray(issue.proposals))) {
        throw new Error('Affected reservation details are unavailable right now.');
      }
      setIssues(result.affectedReservations);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load affected reservations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadIssues(); }, [eventId, token]);

  /** Saves the decision through the event-scoped API and refreshes the issue's current state. */
  async function decide(proposal, decision) {
    setSavingProposalId(proposal.id);
    setError('');
    try {
      await api.post(`/events/equipment-reservation-proposals/${proposal.id}/decision`, { decision }, token);
      await loadIssues();
    } catch (decisionError) {
      setError(decisionError.message || 'Unable to record the Coordinator decision.');
    } finally {
      setSavingProposalId(null);
    }
  }

  return (
    <section className="ed-card ed-span" aria-labelledby="reservation-issues-heading">
      <h2 id="reservation-issues-heading" className="ed-card-title">Affected equipment reservations</h2>
      {error && <p role="alert" className="error-message">{error}</p>}
      {loading ? <p role="status">Loading affected reservations…</p> : issues.length === 0
        ? <p>No confirmed reservations are affected by unavailable equipment.</p>
        : (
          <ul className="ed-clar-list">
            {issues.map(issue => (
              <li key={issue.id} className="ed-clar-item">
                <p><strong>{issue.unavailable_asset_code} — {issue.equipment_name} × {issue.quantity}</strong> is unavailable.</p>
                <p>{issue.reason}</p>
                <p>Reservation: {issue.event_date} {issue.start_time?.slice(0, 5)}–{issue.end_time?.slice(0, 5)}</p>
                {issue.proposals.map(proposal => (
                  <div key={proposal.id}>
                    <p>
                      {proposal.status === 'pending' ? 'Pending proposal' : `Proposal ${proposal.status}`}:
                      {' '}{proposal.assetCode} — {proposal.name} × {proposal.quantity}
                      {proposal.proposedBy ? ` (proposed by ${proposal.proposedBy})` : ''}
                    </p>
                    {proposal.status === 'pending' && (
                      <div className="ed-editor-actions">
                        <button type="button" className="ed-btn" disabled={savingProposalId !== null}
                          onClick={() => decide(proposal, 'accepted')}>
                          {savingProposalId === proposal.id ? 'Saving…' : 'Accept alternative'}
                        </button>
                        <button type="button" className="ed-btn ed-btn--quiet" disabled={savingProposalId !== null}
                          onClick={() => decide(proposal, 'rejected')}>
                          Reject alternative
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {issue.proposals.length === 0 && <p>Technical Support has not proposed an alternative yet.</p>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
