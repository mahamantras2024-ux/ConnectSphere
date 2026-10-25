// File: An event's amendment history and each outcome. The organiser sees their requests awaiting review while the event
// keeps its accepted details (Request All Post-Submission Amendments AC3); the organiser, coordinator and Coordinator Lead
// see what each applied amendment changed, who agreed or decided it, and which checks it reopened (Record Offline AC3/AC5).

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

/** A time shown in Singapore time, as event times are entered. */
const singaporeTime = (value) => new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });

/** The checks an applied amendment reopened, in plain language (AC5). */
function recheckLines(rechecks) {
  if (!rechecks) return [];
  return [
    ...rechecks.venueBookings.map((booking) => `Venue booking at ${booking.venueName} to be re-confirmed by Venue Staff`),
    ...(rechecks.technical ? ['Technical arrangements to be reviewed again'] : []),
    ...(rechecks.safety ? ['A new operational safety check'] : []),
    ...(rechecks.returnedToPlanning ? ['Event returned to planning until approved again'] : []),
  ];
}

/**
 * Lists amendment requests newest first.
 * @param {{ requests: object[]|null, error: string, title?: string, emptyText?: string }} props `requests` is null while
 *   loading; `title` and `emptyText` let the coordinator's history read naturally.
 */
export default function AmendmentRequestList({ requests, error, title = 'Amendment requests', emptyText = 'You have not requested any amendments.' }) {
  return (
    <section className="ed-card amendment-list" aria-labelledby="amendment-list-title">
      <h2 id="amendment-list-title" className="ed-card-title">{title}</h2>
      {error ? <p role="alert" className="ed-notice ed-notice--bad">{error}</p>
        : requests === null ? <p role="status" className="ed-muted">Loading amendment requests…</p>
          : requests.length === 0 ? <p className="ed-muted">{emptyText}</p>
            : (
              <ul className="amendment-items">
                {requests.map((request) => {
                  // The database only stores these three statuses (event_change_requests status check).
                  const [label, tone] = STATUS[request.status];
                  const agreed = request.source === 'coordinator_agreed';
                  const checks = recheckLines(request.rechecks);
                  return (
                    <li key={request.id} className="amendment-item">
                      <div className="amendment-item-head">
                        <span className={`ed-badge ${tone}`}>{label}</span>
                        <span>{agreed ? 'Agreed with the organiser and applied by the Event Coordinator' : 'Requested by the organiser'}</span>
                        <time dateTime={request.submitted_at}>{agreed ? 'Applied' : 'Requested'} {singaporeTime(request.submitted_at)}</time>
                      </div>
                      <dl className="amendment-changes">
                        {request.changes.map((change) => (
                          <div key={change.field}><dt>{change.label}</dt>
                            {/* An applied amendment keeps its earlier value, so the history shows what changed. */}
                            <dd>{'before' in change ? `${shownValue(change.before)} → ${shownValue(change.after)}` : shownValue(change.requested)}</dd></div>
                        ))}
                      </dl>
                      {request.explanation && <p><strong>{agreed ? 'What was agreed:' : 'Explanation:'}</strong> {request.explanation}</p>}
                      {request.clarification_id && <p className="ed-muted">Agreed in clarification #{request.clarification_id}</p>}
                      {!agreed && request.reviewed_at && <p className="ed-muted">Decided by {request.reviewed_by_name} on {singaporeTime(request.reviewed_at)}</p>}
                      {request.decision_reason && <p><strong>Coordinator&apos;s note:</strong> {request.decision_reason}</p>}
                      {checks.length > 0 && <p><strong>Checks reopened:</strong> {checks.join('; ')}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
    </section>
  );
}
