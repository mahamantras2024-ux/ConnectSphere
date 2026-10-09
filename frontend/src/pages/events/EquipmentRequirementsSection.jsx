// File: Shows an event's equipment and technical-support requirements and lets its organiser update them.
import { useState } from 'react';
import { api } from '../../api/client';
import ActionConfirmation from '../../components/ActionConfirmation';
import EquipmentRequirementsFields from './EquipmentRequirementsFields';
import { equipmentError, equipmentFromEvent, equipmentPayload, formatEquipmentItems } from './equipmentRequirements';

// Same pencil as the rest of the event page. Card, field, badge and input styles (the "ed-" classes) come from EventDetail.
const PencilIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 20h9" />
    <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
  </svg>
);

const WIDE = { gridColumn: '1 / -1' };

/**
 * Displays equipment items, support needs and technical specifications for an event.
 * Editing follows the rest of the event page: organisers get a pencil control (labelled "Request change" once
 * Technical Support has confirmed the arrangements) and "Save changes"/"Submit change request" with Cancel. After
 * confirmation the edit becomes a change request and the confirmed values stay on screen until the coordinator reviews it.
 * @param {object} props
 * @param {object} props.event the loaded event record.
 * @param {boolean} props.canEdit true for the owning organiser.
 * @param {string} props.token session token for the API.
 * @param {(fields: object) => void} props.onSaved receives saved equipment fields to merge into the event.
 * @param {(message: string) => void} props.onMessage shows the server's confirmation in the page status region.
 * @param {import('react').ReactNode} props.children the existing "Other equipment notes" display/editor.
 */
export default function EquipmentRequirementsSection({ event, canEdit, token, onSaved, onMessage, children }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [success, setSuccess] = useState('');
  const confirmed = Boolean(event.equipment_confirmed);
  const editLabel = confirmed ? 'Request change to Equipment requirements' : 'Edit Equipment requirements';

  // Runs only after review confirmation: save unconfirmed requirements (200), or request a confirmed change (202).
  async function save() {
    setSaving(true); setError(''); onMessage('');
    try {
      const data = await api.put(`/events/${event.id}/equipment`, equipmentPayload(draft), token);
      // Only equipment columns are merged: the raw UPDATE row would otherwise overwrite formatted fields such as dates.
      if (!data.changeRequest) {
        onSaved({ equipment_items: data.event.equipment_items, technical_support_required: data.event.technical_support_required,
          technical_support_details: data.event.technical_support_details, video_conferencing_required: data.event.video_conferencing_required,
          technical_specifications: data.event.technical_specifications });
      }
      setSuccess(data.message);
      setDraft(null);
    } catch (err) {
      // Keeps the organiser's edits on screen so a failed save can be corrected and retried.
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="event-attachments ed-card ed-span" aria-labelledby="equipment-heading">
      <div className="ed-card-head">
        <div className="ed-title-group">
          <h2 id="equipment-heading" className="ed-card-title">Equipment &amp; Technical Support</h2>
          {canEdit && !draft && (
            <button type="button" className="ed-icon-btn" aria-label={editLabel} title={editLabel}
              onClick={() => { onMessage(''); setDraft(equipmentFromEvent(event)); }}><PencilIcon /></button>
          )}
        </div>
        <span className={`ed-badge ${confirmed ? 'ed-badge--ok' : 'ed-badge--warn'}`}>
          {confirmed ? 'Arrangements confirmed' : 'Awaiting technical arrangement'}
        </span>
      </div>
      {draft ? (
        <form className="ed-editor equipment-editor" style={{ maxWidth: 'none' }} onSubmit={(e) => {
          // Validate before review; the API runs only after the organiser explicitly confirms.
          e.preventDefault(); const problem = equipmentError(draft); setError(problem); if (!problem) setReviewing(true);
        }}>
          {confirmed && <p className="ed-muted">Arrangements are confirmed, so your edit is sent to the Event Coordinator as a change request. The confirmed details stay in effect until review.</p>}
          <EquipmentRequirementsFields value={draft} onChange={setDraft} disabled={saving} />
          {error && !reviewing && <p role="alert" className="ed-notice ed-notice--bad">{error}</p>}
          <div className="ed-editor-actions">
            <button type="submit" className="button-primary" disabled={saving}>
              {saving ? 'Saving…' : confirmed ? 'Submit change request' : 'Save changes'}
            </button>
            <button type="button" className="button-secondary" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <dl className="ed-fields ed-fields--tiles" style={{ '--ed-cols': 2 }}>
          <div className="ed-field">
            <dt>Equipment items</dt>
            <dd>{formatEquipmentItems(event.equipment_items)}</dd>
          </div>
          <div className="ed-field">
            <dt>Technical support</dt>
            <dd>{event.technical_support_required ? `Required: ${event.technical_support_details}` : 'Not required'}</dd>
          </div>
          <div className="ed-field">
            <dt>Video-conferencing / hybrid</dt>
            <dd>{event.video_conferencing_required ? 'Required' : 'Not required'}</dd>
          </div>
          <div className="ed-field">
            <dt>Special technical specifications</dt>
            <dd>{event.technical_specifications || 'Not specified'}</dd>
          </div>
          <div className="ed-field" style={WIDE}>
            <dt>Other equipment notes</dt>
            <dd>{children}</dd>
          </div>
        </dl>
      )}
      {reviewing && <ActionConfirmation action={confirmed ? 'submit this equipment change request' : 'update these equipment requirements'} busy={saving} error={error} success={success} onConfirm={save} onClose={() => {
        // Keep cancelled edits available; acknowledge a successful update in the surrounding event page.
        setReviewing(false); setError(''); if (success) { onMessage(success); setSuccess(''); }
      }} />}
    </section>
  );
}