import { useId, useState } from 'react';
import './AttendeeSections.css';

/** Keeps each attendee disclosure independent; hidden content stays mounted so refreshes cannot reset drafts or choices. */
export default function AttendeeSection({ title, count, children, initiallyExpanded = true, level = 'h2', buttonRef }) {
  const id = useId();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const Heading = level;
  // Heading level also identifies nested groups; standalone registration sections remain full-size parents.
  return <section className={`attendee-section${level === 'h3' ? ' attendee-section--nested' : ''}`}>
    <Heading className="attendee-section-heading"><button ref={buttonRef} type="button" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(current => !current)}>
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{`${title} (${count})`}
    </button></Heading>
    <div id={id} role="region" aria-label={title} hidden={!expanded} className="attendee-section-body">{children}</div>
  </section>;
}
