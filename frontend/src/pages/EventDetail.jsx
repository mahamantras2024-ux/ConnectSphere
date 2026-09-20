import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

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

  const fieldValue = (value) => value ?? 'Not specified';

  const formatDate = (value) => {
    if (!value) return 'Not specified';
    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
          <p className="text-base font-medium text-slate-600">Loading event details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700 shadow-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          No event details available.
        </div>
      </div>
    );
  }

  const overview = [
    { label: 'Title', value: fieldValue(event.name) },
    { label: 'Status', value: fieldValue(event.status) },
    { label: 'Purpose', value: fieldValue(event.purpose) },
    { label: 'Description', value: fieldValue(event.description) },
  ];

  const logistics = [
    { label: 'Date', value: formatDate(event.proposed_date) },
    { label: 'Start Time', value: fieldValue(event.proposed_start_time) },
    { label: 'End Time', value: fieldValue(event.proposed_end_time) },
    { label: 'Expected Attendance', value: fieldValue(event.expected_attendance) },
  ];

  const requirements = [
    { label: 'Programme', value: fieldValue(event.programme_details) },
    { label: 'Layout Requirements', value: fieldValue(event.room_layout_preference) },
    { label: 'Accessibility Needs', value: fieldValue(event.accessibility_requirements) },
    { label: 'Equipment Requests', value: fieldValue(event.equipment_requests) },
  ];

  const registration = [
    { label: 'Registration Required', value: event.registration_required ? 'Yes' : 'No' },
    { label: 'Registration Capacity', value: fieldValue(event.registration_capacity) },
    { label: 'Special Arrangements', value: fieldValue(event.special_arrangements) },
    { label: 'Organiser', value: fieldValue(event.organiser_name) },
    { label: 'Coordinator', value: fieldValue(event.coordinator_name) },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
            Event Detail
          </span>
          <span className="text-sm text-slate-500">ID #{fieldValue(event.id)}</span>
        </div>

        <h1 className="text-4xl font-black tracking-tight text-slate-900">
          {fieldValue(event.name)}
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
            {fieldValue(event.status)}
          </span>
          <span className="text-sm text-slate-500">
            {fieldValue(event.event_type)}
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Event Overview</h2>
          <dl className="space-y-4">
            {overview.map((item) => (
              <div
                key={item.label}
                className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {item.label}
                </dt>
                <dd className="mt-1 text-base font-medium text-slate-900">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Logistics & Schedule</h2>
          <dl className="space-y-4">
            {logistics.map((item) => (
              <div
                key={item.label}
                className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {item.label}
                </dt>
                <dd className="mt-1 text-base font-medium text-slate-900">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Requirements</h2>
          <dl className="grid gap-4 md:grid-cols-2">
            {requirements.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-100 bg-slate-50 p-4"
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {item.label}
                </dt>
                <dd className="mt-2 text-base font-medium text-slate-900">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Registration & Coordination</h2>
          <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {registration.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-100 bg-slate-50 p-4"
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {item.label}
                </dt>
                <dd className="mt-2 text-base font-medium text-slate-900">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}