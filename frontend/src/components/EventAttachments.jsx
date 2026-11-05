import { useRef, useState } from 'react';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MiB
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|doc|pdf)$/i;
const ACCEPT_ATTRIBUTE = '.png,.jpg,.jpeg,.doc,.pdf';
const FILE_ERROR = 'Choose a PNG, JPG, JPEG, DOC or PDF file of up to 2 MB.';

export const attachmentFields = {
  name: 'Event name',
  purpose: 'Purpose',
  description: 'Description',
  eventType: 'Event type',
  roomLayoutPreference: 'Room layout preference',
  programmeDetails: 'Programme',
  equipmentNotes: 'Equipment requirements',
  specialArrangements: 'Special arrangements',
  // New equipment free-text questions follow the same per-question evidence policy.
  technicalSupportDetails: 'Technical support details',
  technicalSpecifications: 'Special technical specifications',
};

function isValidFile({ name, size }) {
  return ALLOWED_EXTENSIONS.test(name) && size >= 1 && size <= MAX_FILE_SIZE;
}

function toDataUrl({ type, data }) {
  return `data:${type || 'application/octet-stream'};base64,${data}`;
}

/** Reads one allowed file of up to 2 MiB for an authenticated event request; the server verifies its bytes. */
export function readAttachment(file) {
  if (!isValidFile(file)) {
    return Promise.reject(new Error(FILE_ERROR));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read this file.'));
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1];
      resolve({ name: file.name, data: base64 });
    };
    reader.readAsDataURL(file);
  });
}

/** Keeps a question's file picker, download and removal control together; removal also clears the native selection. */
function AttachmentRow({ field, label, attachment, reading, onSelect, onChange }) {
  const canEdit = Boolean(onChange);
  const inputRef = useRef(null);

  return (
    <div className="attachment-row">
      {canEdit && (
        <label>
          {label} attachment
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            disabled={reading}
            onChange={(event) => onSelect(field, event.target.files?.[0])}
          />
        </label>
      )}

      {attachment && (
        <>
          <a download={attachment.name} href={toDataUrl(attachment)}>
            {attachment.name}
          </a>
          {canEdit && (
            <button
              type="button"
              className="attachment-delete button-secondary"
              aria-label={`Remove ${label} attachment`}
              title={`Remove ${label} attachment`}
              disabled={reading}
              onClick={() => {
                // File inputs are uncontrolled: clearing React state alone leaves the browser's chosen filename behind.
                inputRef.current.value = '';
                onChange(field, null);
              }}
            >
              <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  );
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

  return (
    <section className="event-attachments">
      <h2>Supporting documents</h2>
      <p>
        One optional file per question, up to 2 MB. PNG, JPG, JPEG, DOC or PDF.
        Accessibility needs are text-only.
      </p>

      {error && <p role="alert">{error}</p>}

      {Object.entries(attachmentFields).map(([field, label]) => (
        <AttachmentRow
          key={field}
          field={field}
          label={label}
          attachment={value[field]}
          reading={reading}
          onSelect={select}
          onChange={onChange}
        />
      ))}
    </section>
  );
}
