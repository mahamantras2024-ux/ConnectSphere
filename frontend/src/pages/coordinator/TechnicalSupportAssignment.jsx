import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';

/** Edits equipment-review or on-site teams; saved assignments stay locked until Change assignment is selected. */
export default function TechnicalSupportAssignment({ event, token, staff, onSaved }) {
  const reviewOnly = event.technical_support_required === false;
  const assignedIds = (event.technical_support_staff || []).map(member => String(member.id));
  const [selected, setSelected] = useState(assignedIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // A draft belongs to the coordinator until a successful save; polling must not replace it.
  // The ref records editing immediately, before a background-response effect can run.
  const editing = useRef(false);
  // A loaded team is already saved, even when this page visit has not submitted anything.
  const [saved, setSaved] = useState(assignedIds.length > 0);
  useEffect(() => {
    if (editing.current) return;
    // Idle forms follow persisted data; active drafts and pending/failed saves keep their selection.
    setSelected(assignedIds);
    setSaved(assignedIds.length > 0);
  }, [event.technical_support_staff]);

  /** Persists the complete selected team; failures keep the form available for a retry. */
  async function submit(eventValue) {
    eventValue.preventDefault();
    editing.current = true;
    setSaving(true); setSaved(false); setError('');
    try {
      await api.put(`/events/${event.id}/technical-support-assignment`,
        { staffIds: selected.map(Number) }, token);
      onSaved(selected.map(id => staff.find(member => String(member.id) === id)));
      editing.current = false;
      setSaved(true);
    } catch (saveError) {
      setError(saveError.message);
    } finally { setSaving(false); }
  }

  return (
    <form className="support-assignment-form" onSubmit={submit}>
      <div className="support-assignment-header">
        <div>
          <h4>{reviewOnly ? 'Equipment request review' : 'Technical support'}</h4>
          <p>{reviewOnly ? 'Select the staff who will review this equipment request. On-site technical support has not been requested.' : 'Select the staff who will be on site for this event.'}</p>
        </div>
      </div>
      {staff.length === 0 ? <p className="support-assignment-empty">No Technical Support Staff are available.</p> : (
        // Saved teams require an explicit edit action; pending saves also lock the whole roster to preserve the submitted draft.
        <fieldset className="support-assignment-fieldset" disabled={saving || saved}>
          <legend className="sr-only">Technical Support Staff</legend>
          <div className="support-assignment-options">
            {staff.map(member => (
              <label key={member.id} className="support-assignment-option">
                <input type="checkbox" checked={selected.includes(String(member.id))}
                  onChange={change => {
                    editing.current = true;
                    setSaved(false);
                    setSelected(current => change.target.checked
                      ? [...current, String(member.id)] : current.filter(id => id !== String(member.id)));
                  }}
                />
                <span>{member.full_name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && <p role="alert" className="error-message">{error}</p>}
      {staff.length > 0 && <div className="support-assignment-actions">
        <button type="submit" className="button-primary support-assignment-button" disabled={saving || saved || selected.length === 0}>
          {saving ? 'Saving…' : saved ? 'Assignment saved' : 'Assign staff'}
        </button>
        {saved && <button type="button" className="button-secondary support-assignment-change"
          onClick={() => { editing.current = true; setSaved(false); setError(''); }}>
          Change assignment
        </button>}
      </div>}
    </form>
  );
}
