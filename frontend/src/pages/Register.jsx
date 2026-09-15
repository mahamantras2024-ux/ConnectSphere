import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLES = [
  { value: 'event_organiser', label: 'Event Organiser (external)' },
  { value: 'event_coordinator', label: 'Event Coordinator (internal)' },
  { value: 'venue_staff', label: 'Venue Staff (internal)' },
  { value: 'technical_support', label: 'Technical Support Staff (internal)' },
  { value: 'attendee', label: 'Attendee (external)' },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: '', password: '', fullName: '', role: 'event_organiser', organisationName: '', phone: '',
  });
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await register(form);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h1>Register</h1>
      {/* TODO: in the real product, staff roles likely shouldn't be self-service sign-up.
          Left open here so every role can be exercised during development. */}
      <form onSubmit={handleSubmit}>
        <label>Full name
          <input value={form.fullName} onChange={(e) => update('fullName', e.target.value)} required />
        </label>
        <label>Email
          <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
        </label>
        <label>Password
          <input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required />
        </label>
        <label>Role
          <select value={form.role} onChange={(e) => update('role', e.target.value)}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {form.role === 'event_organiser' && (
          <label>Organisation name
            <input value={form.organisationName} onChange={(e) => update('organisationName', e.target.value)} />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <button type="submit">Create account</button>
      </form>
    </div>
  );
}
