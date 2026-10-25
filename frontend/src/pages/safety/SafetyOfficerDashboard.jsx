// File: Safety Officer workspace: account details plus the Operational Safety Check queue.
import StaffWorkspace from '../StaffWorkspace';
import SafetyCheckQueue from './SafetyCheckQueue';
import NotificationsPanel from '../../components/NotificationsPanel';

// Renders the Safety Officer landing page with the events ready for a safety review (Week 7 change 6).
export default function SafetyOfficerDashboard() { return <StaffWorkspace role="safety_officer"><NotificationsPanel /><SafetyCheckQueue /></StaffWorkspace>; }
