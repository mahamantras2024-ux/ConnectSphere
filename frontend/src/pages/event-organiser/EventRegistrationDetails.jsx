import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import OrganiserRegistrationDrawer from './OrganiserRegistrationDrawer';

/** Keeps existing registration URLs usable; closing their drawer returns to the same owned event. */
export default function EventRegistrationDetails() {
  const { id } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  return <OrganiserRegistrationDrawer eventId={id} token={token} onClose={() => navigate(`/organizer/events/${id}`)} />;
}
