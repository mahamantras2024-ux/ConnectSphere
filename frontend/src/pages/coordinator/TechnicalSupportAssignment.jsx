import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';

/** Lets an Event Coordinator replace the complete on-site support team for one event. */
export default function TechnicalSupportAssignment({ event, token, staff, onSaved }) {
  const assignedIds = (event.technical_support_staff || []).map(member => String(member.id));
  const [selected, setSelected] = useState(assignedIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => setSelected(assignedIds), [event.technical_support_staff]);

  async function submit(eventValue) {
    eventValue.preventDefault();
    setSaving(true); setError('');
    try {
      await api.put(`/events/${event.id}/technical-support-assignment`,
        { staffIds: selected.map(Number) }, token);
      onSaved(selected.map(id => staff.find(member => String(member.id) === id)));
      setSaved(true);
    } catch (saveError) {
      setError(saveError.message);
    } finally { setSaving(false); }
  }

  return (
    <form className="support-assignment-form" onSubmit={submit}>
      <div className="support-assignment-header">
        <div>
          <h4>Technical support</h4>
          <p>Select the staff who will be on site for this event.</p>
        </div>
      </div>
      {staff.length === 0 ? <p className="support-assignment-empty">No Technical Support Staff are available.</p> : (
        <fieldset className="support-assignment-fieldset" disabled={saving}>
          <legend className="sr-only">Technical Support Staff</legend>
          <div className="support-assignment-options">
            {staff.map(member => (
              <label key={member.id} className="support-assignment-option">
                <input type="checkbox" checked={selected.includes(String(member.id))}
                  onChange={change => {
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
          onClick={() => { setSaved(false); setError(''); }}>
          Change assignment
        </button>}
      </div>}
    </form>
  );
}
