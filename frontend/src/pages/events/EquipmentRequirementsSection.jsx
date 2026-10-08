// File: Shows an event's equipment and technical-support requirements and lets its organiser update them.
import { useState } from 'react';
import { api } from '../../api/client';
import ActionConfirmation from '../../components/ActionConfirmation';
import EquipmentRequirementsFields from './EquipmentRequirementsFields';
import { equipmentError, equipmentFromEvent, equipmentPayload, formatEquipmentItems } from './equipmentRequirements';

/**
 * Displays equipment items, support needs and technical specifications for an event.
 * Editing follows the rest of the event page: organisers get a ✎ control (✉ once Technical Support has confirmed
 * the arrangements) and "Save changes"/"Submit change request" with Cancel. After confirmation the edit becomes a
 * change request and the confirmed values stay on screen until the coordinator reviews it.
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
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2" aria-labelledby="equipment-heading">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id="equipment-heading" className="text-xl font-bold text-slate-900">Equipment &amp; Technical Support</h2>
          {canEdit && !draft && (
            <button type="button" className={confirmed ? 'text-amber-800 hover:text-amber-950' : 'text-blue-700 hover:text-blue-900'}
              aria-label={editLabel} title={editLabel}
              onClick={() => { onMessage(''); setDraft(equipmentFromEvent(event)); }}>{confirmed ? '✉' : '✎'}</button>
          )}
        </div>
        <span className={`status-badge ${confirmed ? 'status-confirmed' : 'status-under_review'}`}>
          {confirmed ? 'Arrangements confirmed' : 'Awaiting technical arrangement'}
        </span>
      </div>
      {draft ? (
        <form className="equipment-editor grid gap-4" onSubmit={(e) => {
          // Validate before review; the API runs only after the organiser explicitly confirms.
          e.preventDefault(); const problem = equipmentError(draft); setError(problem); if (!problem) setReviewing(true);
        }}>
          {confirmed && <p className="text-sm text-slate-600">Arrangements are confirmed, so your edit is sent to the Event Coordinator as a change request. The confirmed details stay in effect until review.</p>}
          <EquipmentRequirementsFields value={draft} onChange={setDraft} disabled={saving} />
          {error && !reviewing && <p role="alert" className="error-text">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="button-primary" disabled={saving}>
              {saving ? 'Saving…' : confirmed ? 'Submit change request' : 'Save changes'}
            </button>
            <button type="button" className="button-secondary" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Equipment items</dt>
            <dd className="mt-2 text-base font-medium text-slate-900">{formatEquipmentItems(event.equipment_items)}</dd>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Technical support</dt>
            <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
              {event.technical_support_required ? `Required: ${event.technical_support_details}` : 'Not required'}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Video-conferencing / hybrid</dt>
            <dd className="mt-2 text-base font-medium text-slate-900">{event.video_conferencing_required ? 'Required' : 'Not required'}</dd>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Special technical specifications</dt>
            <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">{event.technical_specifications || 'Not specified'}</dd>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 md:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Other equipment notes</dt>
            <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">{children}</dd>
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
