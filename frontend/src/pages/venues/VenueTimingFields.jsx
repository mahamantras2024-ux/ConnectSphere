/** SCRUM-105: explains the two independent booking buffers and links validation errors to each input. */
export default function VenueTimingFields({ data, errors, onChange }) {
  return <fieldset className="venue-timing-fields">
    <legend>Setup &amp; turnaround</legend>
    <p className="field-help" id="venue-timing-help">Reserve preparation time before each event and reset time afterwards. Use 0 when no extra time is needed.</p>
    <div className="form-grid">
      {[
        ['setupMinutes', 'Setup time (minutes)', 'Before each event'],
        ['turnaroundMinutes', 'Turnaround time (minutes)', 'After each event'],
      ].map(([field, label, explanation]) => <div className="field" key={field}>
        <label htmlFor={`venue-${field}`}>{label} *</label>
        <span className="field-help" id={`help-${field}`}>{explanation}</span>
        <input id={`venue-${field}`} type="number" min="0" max="10080" step="1" value={data[field]}
          onChange={event => onChange(field, event.target.value)} aria-invalid={!!errors[field]}
          aria-describedby={`help-${field} venue-timing-help${errors[field] ? ` error-${field}` : ''}`} />
        {errors[field] && <span id={`error-${field}`} className="error-text">{errors[field]}</span>}
      </div>)}
    </div>
    <p className="field-help">Whole minutes, from 0 to 10,080. Availability checks include both buffers.</p>
  </fieldset>;
}
