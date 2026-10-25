// File: The organiser's amendment requests for one event and their outcome (amendment story AC3): a proposal shows as
// awaiting review while the event keeps its accepted details.

// Badge text and tone for each stored request status.
const STATUS = {
  pending: ['Awaiting review', 'ed-badge--warn'],
  approved: ['Approved', 'ed-badge--ok'],
  rejected: ['Not approved', 'ed-badge--bad'],
};

/** Shows a requested value as text; lists (accessibility needs, equipment, attachments) are joined. */
function shownValue(value) {
  if (value == null || value === '') return 'Not specified';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  return String(value);
}

/**
 * Lists amendment requests newest first.
 * @param {{ requests: object[]|null, error: string }} props `requests` is null while loading.
 */
export default function AmendmentRequestList({ requests, error }) {
  return (
    <section className="ed-card amendment-list" aria-labelledby="amendment-list-title">
      <h2 id="amendment-list-title" className="ed-card-title">Amendment requests</h2>
      {error ? <p role="alert" className="ed-notice ed-notice--bad">{error}</p>
        : requests === null ? <p role="status" className="ed-muted">Loading amendment requests…</p>
          : requests.length === 0 ? <p className="ed-muted">You have not requested any amendments.</p>
            : (
              <ul className="amendment-items">
                {requests.map((request) => {
                  // The database only stores these three statuses (event_change_requests status check).
                  const [label, tone] = STATUS[request.status];
                  return (
                    <li key={request.id} className="amendment-item">
                      <div className="amendment-item-head">
                        <span className={`ed-badge ${tone}`}>{label}</span>
                        <time dateTime={request.submitted_at}>Requested {new Date(request.submitted_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })}</time>
                      </div>
                      <dl className="amendment-changes">
                        {request.changes.map((change) => (
                          <div key={change.field}><dt>{change.label}</dt><dd>{shownValue(change.requested)}</dd></div>
                        ))}
                      </dl>
                      {request.explanation && <p><strong>Your explanation:</strong> {request.explanation}</p>}
                      {request.decision_reason && <p><strong>Coordinator&apos;s note:</strong> {request.decision_reason}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
    </section>
  );
}
