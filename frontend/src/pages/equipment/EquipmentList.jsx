import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Equipment Request Management (catalogue part) + a manual
// Equipment Availability Checking tool.
export default function EquipmentList() {
  const { token } = useAuth();
  const [equipment, setEquipment] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/equipment', token).then((data) => setEquipment(data.equipment)).catch((err) => setError(err.message));
  }, [token]);

  return (
    <div>
      <h1>Equipment</h1>
      {error && <p className="error-text">{error}</p>}
      {equipment.map((e) => (
        <div className="card" key={e.id}>
          <h3>{e.name} <span className="badge">{e.type}</span></h3>
          <p>Total quantity: {e.total_quantity}</p>
        </div>
      ))}
      <div className="todo-note">
        TODO: hook up the "check availability for my event's dates" flow using
        GET /api/equipment/:id/availability once Equipment Request Management
        is designed on the event detail page.
      </div>
    </div>
  );
}
