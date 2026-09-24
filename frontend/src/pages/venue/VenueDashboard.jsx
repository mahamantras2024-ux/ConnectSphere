import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import VenueList from '../venues/VenueList';
import AddVenueModal from '../venues/AddVenueModal';

export default function VenueDashboard() {
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <div className="page">
      <h1>Venue Staff Dashboard</h1>
      <p>Welcome, {user.full_name}. View the venue catalogue or add a venue.</p>
      <button onClick={() => setAdding(true)}>Add venue</button>
      <VenueList key={version} />
      {adding && <AddVenueModal onClose={() => setAdding(false)} onAdd={() => setVersion((value) => value + 1)} />}
    </div>
  );
}
