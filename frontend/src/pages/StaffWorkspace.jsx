// File: Displays the signed-in staff account and its provisioned workspaces using verified session data.
import PageIntro from '../components/PageIntro';
import { roleLabels } from '../auth/dashboardRoutes';
import { useAuth } from '../context/AuthContext';
// Shows actual account details without requesting private events or presenting unfinished task queues.
// `children` adds role-specific panels (e.g. Technical Support notifications) below the account details.
export default function StaffWorkspace({ role, children }) {
  const { user } = useAuth();
  const workspaces = (user.roles || [user.role]).map(assignedRole => roleLabels[assignedRole]).join(', ');
  return <div className="page"><PageIntro title={`${roleLabels[role]} Dashboard`} eyebrow="Internal workspace" description="Your account details and authorised workspace." />
    <section className="card"><h2>Account details</h2><dl className="detail-facts"><div><dt>Full name</dt><dd>{user.full_name || 'Not recorded'}</dd></div><div><dt>Email</dt><dd>{user.email || 'Not recorded'}</dd></div><div><dt>Active workspace</dt><dd>{roleLabels[role]}</dd></div><div><dt>Provisioned workspaces</dt><dd aria-label="Provisioned workspaces">{workspaces}</dd></div></dl></section>{children}</div>;
}
