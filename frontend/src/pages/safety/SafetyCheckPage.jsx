import { Link, useParams } from 'react-router-dom';
import PageIntro from '../../components/PageIntro';
import SafetyCheckQueue from './SafetyCheckQueue';

/** Selects one event from the officer's authorized ready queue; stale direct links cannot reopen a completed review. */
export default function SafetyCheckPage() {
  const { id } = useParams();
  return <div className="page safety-check-page">
    <PageIntro title="Conduct safety check" eyebrow="Operational safety" description="Review the confirmed arrangements and record the safety outcome." />
    <Link className="button-link button-secondary" to="/safety/dashboard">Back to safety checks</Link>
    <SafetyCheckQueue eventId={id} />
  </div>;
}
