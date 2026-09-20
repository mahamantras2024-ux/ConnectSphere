import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

export default function EventDetail() {
  const { id } = useParams();
  const { token } = useAuth();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchEvent() {
      try {
        setLoading(true);
        setError('');

        const data = await api.get(`/events/${id}`, token);
        if (isMounted) {
          setEvent(data.event);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to load event details.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    if (id) {
      fetchEvent();
    }

    return () => {
      isMounted = false;
    };
  }, [id, token]);

  if (loading) return <p>Loading event details...</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!event) return <p>No event details available.</p>;

  const fieldValue = (value) => value ?? 'Not specified';

  return (
    <div className="page">
      <div className="card">
        <h1>{fieldValue(event.name)}</h1>
        <p className="muted">Status: {fieldValue(event.status)}</p>

        <dl className="detail-list">
          <div>
            <dt>Purpose</dt>
            <dd>{fieldValue(event.purpose)}</dd>
          </div>

          <div>
            <dt>Event Type</dt>
            <dd>{fieldValue(event.event_type)}</dd>
          </div>

          <div>
            <dt>Date</dt>
            <dd>
              {event.proposed_date
                ? new Date(event.proposed_date).toLocaleDateString()
                : 'Not specified'}
            </dd>
          </div>

          <div>
            <dt>Start Time</dt>
            <dd>{fieldValue(event.proposed_start_time)}</dd>
          </div>

          <div>
            <dt>End Time</dt>
            <dd>{fieldValue(event.proposed_end_time)}</dd>
          </div>

          <div>
            <dt>Expected Attendance</dt>
            <dd>{fieldValue(event.expected_attendance)}</dd>
          </div>

          <div>
            <dt>Programme</dt>
            <dd>{fieldValue(event.programme_details)}</dd>
          </div>

          <div>
            <dt>Layout Requirements</dt>
            <dd>{fieldValue(event.room_layout_preference)}</dd>
          </div>

          <div>
            <dt>Accessibility Needs</dt>
            <dd>{fieldValue(event.accessibility_requirements)}</dd>
          </div>

          <div>
            <dt>Equipment Requests</dt>
            <dd>{fieldValue(event.equipment_requests)}</dd>
          </div>

          <div>
            <dt>Registration Required</dt>
            <dd>{event.registration_required ? 'Yes' : 'No'}</dd>
          </div>

          <div>
            <dt>Registration Capacity</dt>
            <dd>{fieldValue(event.registration_capacity)}</dd>
          </div>

          <div>
            <dt>Special Arrangements</dt>
            <dd>{fieldValue(event.special_arrangements)}</dd>
          </div>

          <div>
            <dt>Description</dt>
            <dd>{fieldValue(event.description)}</dd>
          </div>

          <div>
            <dt>Organiser</dt>
            <dd>{fieldValue(event.organiser_name)}</dd>
          </div>

          <div>
            <dt>Assigned Coordinator</dt>
            <dd>{fieldValue(event.coordinator_name)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
