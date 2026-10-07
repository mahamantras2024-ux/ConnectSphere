// File: Displays the provisioned Technical Support workspace and its notifications without unassigned client data.
import StaffWorkspace from '../StaffWorkspace';
import NotificationsPanel from '../../components/NotificationsPanel';
// Renders the Technical Support landing page with notifications about changed event details.
export default function TechSupportDashboard() { return <StaffWorkspace role="technical_support"><NotificationsPanel /></StaffWorkspace>; }
