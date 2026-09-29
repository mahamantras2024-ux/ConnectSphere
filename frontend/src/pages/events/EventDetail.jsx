import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

export default function EventDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const location = useLocation();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchEvent() {
      try {
        setLoading(true);
        setError('');
        setEvent(null);

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

  const fieldValue = (value) => {
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).join(', ') || 'Not specified';
    if (value == null || (typeof value === 'string' && !value.trim())) return 'Not specified';
    return typeof value === 'string' || typeof value === 'number' ? value : 'Not specified';
  };
  const formatDate = (value) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Not specified';
    const date = value.slice(0, 10);
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return 'Not specified';
    return date.split('-').reverse().join('/');
  };

  const formatStatus = (value) => {
    if (!value) return 'Not specified';
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const formatText = (value) => {
    if (!value) return 'Not specified';
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
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
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700 shadow-sm">
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link to={user.role === 'event_organiser' ? '/organizer/events' : '/events'}>Back to {user.role === 'event_organiser' ? 'My Events' : 'Events'}</Link>
      {location.state?.message && <p role="status">{location.state.message}</p>}
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
            Event Detail
          </span>
          <span className="text-sm text-slate-500">ID #{fieldValue(event.id)}</span>
          <span>{formatStatus(event.status)}</span>
        </div>

        <h1 className="text-4xl font-black tracking-tight text-slate-900">
          {fieldValue(event.name)}
        </h1>
        
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Event Overview</h2>
          <dl className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Purpose
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {fieldValue(event.purpose)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Description
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {fieldValue(event.description)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Event Type
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {formatText(event.event_type)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Logistics & Schedule</h2>
          <dl className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Date
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {formatDate(event.proposed_date)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Start Time
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {fieldValue(event.proposed_start_time)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                End Time
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {fieldValue(event.proposed_end_time)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Expected Attendance
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {fieldValue(event.expected_attendance)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Requirements</h2>
          <dl className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Programme
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.programme_details)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Layout Requirements
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.room_layout_preference)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Accessibility Needs
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.accessibility_requirements)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Equipment Requests
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.equipment_notes)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Special Arrangements</h2>
          <p className="whitespace-pre-wrap">{fieldValue(event.special_arrangements)}</p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Registration & Coordination</h2>
          <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Registration Required
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {event.registration_required == null ? 'Not specified' : event.registration_required ? 'Yes' : 'No'}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Registration Capacity
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.registration_capacity)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Organiser
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.organiser_name)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Coordinator
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.coordinator_name)}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}