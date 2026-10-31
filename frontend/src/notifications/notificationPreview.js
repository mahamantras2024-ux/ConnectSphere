// File: Turns a stored notification into a preview readable at a glance (parent notification system AC2/AC3).

/** Longest one-line summary shown in a preview; longer text is cut at a word boundary and ends with "…". */
export const PREVIEW_LIMIT = 90;

/**
 * The first line of a notification message, shortened for a preview (AC2). Messages often carry extra lines (reasons,
 * notes); those stay in the full record, while the preview keeps only the headline sentence.
 * @param {string} message the stored plain-text message.
 * @returns {string} at most PREVIEW_LIMIT characters.
 */
export function previewText(message) {
  const firstLine = String(message || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
  if (firstLine.length <= PREVIEW_LIMIT) return firstLine;
  const cut = firstLine.slice(0, PREVIEW_LIMIT - 1);
  const wordEnd = cut.lastIndexOf(' ');
  // Prefer ending on a whole word unless that would throw away most of the line.
  return `${(wordEnd > PREVIEW_LIMIT / 2 ? cut.slice(0, wordEnd) : cut).trimEnd()}…`;
}

/** The exact time in Singapore, matching how event times are entered and shown elsewhere (AC3). */
export function exactTime(value) {
  return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * How long ago something happened, for a glance (AC3): "Just now", "5 min ago", "3 h ago", "2 days ago". From a week
 * on it returns null, because the exact date shown beside it is then clearer than a long relative span.
 * @param {string} value ISO timestamp of the update.
 * @param {number} [now] current time in ms (injectable for tests).
 * @returns {string|null}
 */
export function relativeTime(value, now = Date.now()) {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} day${days === 1 ? '' : 's'} ago` : null;
}

/**
 * Renders a stored Equipment_Status as the words shown to a member (AC3). Statuses are stored in snake_case
 * (e.g. "under_maintenance"); the underscores are replaced with spaces so the preview reads naturally
 * ("under maintenance") instead of leaking the storage format. A missing status yields an empty string rather than
 * throwing, so a malformed notification never breaks the preview.
 * @param {string} status the stored status value, e.g. "damaged" or "under_maintenance".
 * @returns {string} human-readable status words, or '' when no status is given.
 */
export function humanEquipmentStatus(status) {
  return String(status || '').replace(/_/g, ' ');
}
