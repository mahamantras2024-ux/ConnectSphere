import { useAuth } from '../context/AuthContext';
import Modal from './Modal';
import CoordinatorReminderPreferences from '../pages/coordinator/CoordinatorReminderPreferences';
import VenueReminderPreferences from '../pages/venue/VenueReminderPreferences';
import ReminderPreference from '../pages/tech-support/ReminderPreference';

/** Shows only the active role's persisted reminder preferences; unsupported roles get an honest empty state. */
export default function NotificationSettings({ onClose }) {
  const { user, token } = useAuth();
  const forms = {
    event_coordinator: <CoordinatorReminderPreferences token={token} />,
    venue_staff: <VenueReminderPreferences />,
    technical_support: <ReminderPreference />,
  };
  // A new session remounts the form so a late response cannot carry a previous workspace's choices forward.
  return <Modal title="Notification settings" onClose={onClose}>
    <div className="notification-settings" key={`${user.role}:${token}`}>
      {forms[user.role] || <p>There are no reminder preferences for this workspace.</p>}
    </div>
  </Modal>;
}
