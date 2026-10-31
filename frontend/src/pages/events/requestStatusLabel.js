// SCRUM-93: use one human-readable label in lists and status snapshots.
/** Formats a stored lifecycle status; a missing draft status retains the existing Draft fallback. */
export function requestStatusLabel(status) {
  return status ? status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Draft';
}
