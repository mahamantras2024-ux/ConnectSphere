// File: Displays the Venue Staff catalogue and creation modal and refreshes the catalogue after creation.
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import VenueList from '../venues/VenueList';
import AddVenueModal from '../venues/AddVenueModal';
import PageIntro from '../../components/PageIntro';

// Renders Venue Staff catalogue/creation controls and remounts the catalogue after a new venue.
export default function VenueDashboard() {
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <div className="page">
      <PageIntro title="Venue Staff Dashboard" eyebrow="Spaces & possibilities" description={`Welcome, ${user.full_name}. Keep every space ready for its next event.`} action={<button onClick={() => // Opens the venue creation dialog.

      // Handles this control action and updates the screen state.
      setAdding(true)}>Add venue <span aria-hidden="true">+</span></button>} />
      <VenueList key={version} />
      {adding && <AddVenueModal onClose={() => // Closes the venue creation modal.

      // Handles this control action and updates the screen state.
      setAdding(false)} onAdd={() => // Increments the catalogue key so it reloads after a new venue is created.

      // Handles this control action and updates the screen state.
      setVersion((value) => // Computes the next catalogue refresh version from the previous version.

      // Handles this operation using the surrounding screen or request state.
      value + 1)} />}
    </div>
  );
}
