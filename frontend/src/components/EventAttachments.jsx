import { useState } from 'react';

export const attachmentFields = {
  name: 'Event name', purpose: 'Purpose', description: 'Description', eventType: 'Event type',
  roomLayoutPreference: 'Room layout preference', programmeDetails: 'Programme',
  equipmentNotes: 'Equipment requirements', specialArrangements: 'Special arrangements',
  // New equipment free-text questions follow the same per-question evidence policy.
  technicalSupportDetails: 'Technical support details', technicalSpecifications: 'Special technical specifications',
};

/** Reads one allowed file of up to 2 MiB for an authenticated event request; the server verifies its bytes. */
export function readAttachment(file) {
  if (!/\.(png|jpe?g|doc|pdf)$/i.test(file.name) || file.size < 1 || file.size > 2 * 1024 * 1024) {
    return Promise.reject(new Error('Choose a PNG, JPG, JPEG, DOC or PDF file of up to 2 MB.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read this file.'));
    reader.onload = () => resolve({ name: file.name, data: String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  });
}

/** Displays private per-question downloads and optional replacement/removal controls for organisers. */
export default function EventAttachments({ value = {}, onChange, onBusy }) {
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);

  /** Keeps the previous file on failure and blocks competing replacements while the browser reads bytes. */
  async function select(field, file) {
    if (!file) return;
    setError('');
    setReading(true);
    onBusy(1);
    try {
      onChange(field, await readAttachment(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setReading(false);
      onBusy(-1);
    }
  }

  return <section className="event-attachments">
    <h2>Supporting documents</h2>
    <p>One optional file per question, up to 2 MB. PNG, JPG, JPEG, DOC or PDF. Accessibility needs are text-only.</p>
    {error && <p role="alert">{error}</p>}
    {Object.entries(attachmentFields).map(([field, label]) => <div className="attachment-row" key={field}>
      {onChange && <label>{label} attachment
        <input type="file" disabled={reading} accept=".png,.jpg,.jpeg,.doc,.pdf"
          onChange={event => select(field, event.target.files?.[0])} />
      </label>}
      {value[field] && <>
        <a download={value[field].name} href={`data:${value[field].type || 'application/octet-stream'};base64,${value[field].data}`}>{value[field].name}</a>
        {onChange && <button type="button" disabled={reading} className="button-secondary"
          onClick={() => onChange(field, null)}>Remove {label} attachment</button>}
      </>}
    </div>)}
  </section>;
}
