// File: Displays the coordinator's assigned events using the assignment-scoped API.
import EventList from '../events/EventList';
import {useAuth} from '../../context/AuthContext';
import CoordinatorReminderPreferences from './CoordinatorReminderPreferences';
// Keeps the assignment-scoped event workspace separate from venue discovery in its own navigation tab.
/** SCRUM-85 AC9: the coordinator dashboard exposes the persisted review-reminder choice alongside assigned work. */
export default function CoordinatorDashboard() { const {token}=useAuth();return <><EventList dashboard /><CoordinatorReminderPreferences token={token}/></>; }
