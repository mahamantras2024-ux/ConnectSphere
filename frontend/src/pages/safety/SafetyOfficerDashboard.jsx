// File: Safety Officer workspace focused on events ready for an Operational Safety Check.
import PageIntro from '../../components/PageIntro';
import SafetyCheckQueue from './SafetyCheckQueue';

// Renders the Safety Officer landing page with the events ready for a safety review (Week 7 change 6).
export default function SafetyOfficerDashboard() { return <div className="page"><PageIntro title="Safety Officer Dashboard" eyebrow="Internal workspace" description="Review events ready for an operational safety check." /><SafetyCheckQueue /></div>; }
