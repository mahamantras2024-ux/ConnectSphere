// File: Separates the Venue Staff overview, venue catalogue and booking-review workspace.
import { useLayoutEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import VenueList from '../venues/VenueList';
import AddVenueModal from '../venues/AddVenueModal';
import PageIntro from '../../components/PageIntro';
import NotificationsPanel from '../../components/NotificationsPanel';
import VenueBookingInbox from './VenueBookingInbox';
import VenueEventStatusPanel from './VenueEventStatusPanel';
import VenueReminderPreferences from './VenueReminderPreferences';

/** Keeps staff sections bookmarkable and mounts only the selected workspace; creation refreshes the venue catalogue. */
export default function VenueDashboard() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const requestedSection = params.get('section');
  const section = ['venues', 'requests'].includes(requestedSection) ? requestedSection : 'dashboard';
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);

  // Clear abandoned dialogs before paint on section changes, without racing the first Add venue click.
  useLayoutEffect(() => { setAdding(false); }, [section]);

  return (
    <div className="page">
      <PageIntro title="Venue Staff Dashboard" eyebrow="Spaces & possibilities"
        description={`Welcome, ${user.full_name}. Keep every space ready for its next event.`}
        action={section === 'venues' ? <button onClick={() => setAdding(true)}>Add venue <span aria-hidden="true">+</span></button> : undefined} />
      {section === 'dashboard' && <>
        <NotificationsPanel />
        <VenueEventStatusPanel />
        <VenueReminderPreferences />
      </>}
      {section === 'requests' && <VenueBookingInbox />}
      {section === 'venues' && <VenueList key={version} />}
      {adding && section === 'venues' && <AddVenueModal onClose={() => setAdding(false)}
        onAdd={() => setVersion(value => value + 1)} />}
    </div>
  );
}
