import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

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
    if (Array.isArray(value)) {
      return (
        value
          .filter(
            (item) =>
              typeof item === 'string' &&
              item.trim()
          )
          .join(', ') || 'Not specified'
      );
    }

    if (
      value == null ||
      (typeof value === 'string' && !value.trim())
    ) {
      return 'Not specified';
    }

    return typeof value === 'string' ||
      typeof value === 'number'
      ? value
      : 'Not specified';
  };

  const formatDate = (value) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return 'Not specified';
    }

    const date = value.slice(0, 10);

    if (
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    ) {
      return 'Not specified';
    }

    return date.split('-').reverse().join('/');
  };

  const formatStatus = (value) => {
    if (!value) return 'Not specified';

    return (
      value.charAt(0).toUpperCase() +
      value.slice(1)
    );
  };

  const formatText = (value) => {
    if (!value) return 'Not specified';

    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) =>
        char.toUpperCase()
      );
  };

  const getStatusClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'submitted':
        return 'status-submitted';

      case 'approved':
        return 'status-approved';

      case 'pending':
        return 'status-pending';

      case 'rejected':
        return 'status-rejected';

      case 'draft':
        return 'status-draft';

      default:
        return 'status-draft';
    }
  };

  if (loading) {
    return (
      <>
        <style>{styles}</style>

        <div className="detail-state-page">
          <div className="detail-state-card">
            Loading event details...
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <style>{styles}</style>

        <div className="detail-state-page">
          <div
            role="alert"
            className="detail-state-card detail-error"
          >
            ⚠️ {error}
          </div>
        </div>
      </>
    );
  }

  if (!event) {
    return (
      <>
        <style>{styles}</style>

        <div className="detail-state-page">
          <div className="detail-state-card">
            No event details available.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>

      <div className="event-detail-page">
        <div className="event-detail-container">

          <Link
            to={
              user.role === 'event_organiser'
                ? '/organizer/events'
                : '/events'
            }
            className="event-back-link"
          >
            <span className="back-arrow">←</span>

            Back to{' '}
            {user.role === 'event_organiser'
              ? 'My Events'
              : 'Events'}
          </Link>

          {location.state?.message && (
            <div
              role="status"
              className="event-success"
            >
              <span className="success-icon">
                ✓
              </span>

              {location.state.message}
            </div>
          )}

          <div className="event-detail-card">

            {/* Header inside card */}
            <div className="event-card-header">

              <div className="event-title-row">
                <h1 className="event-detail-title">
                  {fieldValue(event.name)}
                </h1>

                <span
                  className={`event-status ${getStatusClass(
                    event.status
                  )}`}
                >
                  {formatStatus(event.status)}
                </span>
              </div>

            </div>

            {/* Event Information */}
            <section className="detail-section">

              <div className="detail-section-heading">
                <span className="detail-section-number">
                  1
                </span>

                <h2>
                  Event Information
                </h2>
              </div>

              <dl className="detail-grid">

                <div className="detail-item">
                  <dt>
                    Purpose
                  </dt>

                  <dd>
                    {fieldValue(event.purpose)}
                  </dd>
                </div>

                <div className="detail-item">
                  <dt>
                    Event Type
                  </dt>

                  <dd>
                    {formatText(event.event_type)}
                  </dd>
                </div>

                <div className="detail-item detail-full">
                  <dt>
                    Description
                  </dt>

                  <dd>
                    {fieldValue(event.description)}
                  </dd>
                </div>

              </dl>

            </section>

            {/* Date & Attendance */}
            <section className="detail-section">

              <div className="detail-section-heading">
                <span className="detail-section-number">
                  2
                </span>

                <h2>
                  Date & Attendance
                </h2>
              </div>

              <dl className="detail-grid-5">

                <div className="summary-card">
                  <dt>
                    Date
                  </dt>

                  <dd>
                    {formatDate(event.proposed_date)}
                  </dd>
                </div>

                <div className="summary-card">
                  <dt>
                    Start Time
                  </dt>

                  <dd>
                    {fieldValue(
                      event.proposed_start_time
                    )}
                  </dd>
                </div>

                <div className="summary-card">
                  <dt>
                    End Time
                  </dt>

                  <dd>
                    {fieldValue(
                      event.proposed_end_time
                    )}
                  </dd>
                </div>

                <div className="summary-card">
                  <dt>
                    Attendance
                  </dt>

                  <dd>
                    {fieldValue(
                      event.expected_attendance
                    )}
                  </dd>
                </div>

                <div className="summary-card">
                  <dt>
                    Room Layout
                  </dt>

                  <dd>
                    {fieldValue(
                      event.room_layout_preference
                    )}
                  </dd>
                </div>

              </dl>

            </section>

            {/* Event Requirements */}
            <section className="detail-section">

              <div className="detail-section-heading">
                <span className="detail-section-number">
                  3
                </span>

                <h2>
                  Event Requirements
                </h2>
              </div>

              <dl className="requirement-grid">

                <div className="requirement-card full">
                  <dt>
                    Programme
                  </dt>

                  <dd>
                    {fieldValue(
                      event.programme_details
                    )}
                  </dd>
                </div>

                <div className="requirement-card">
                  <dt>
                    Equipment Requirements
                  </dt>

                  <dd>
                    {fieldValue(
                      event.equipment_notes
                    )}
                  </dd>
                </div>

                <div className="requirement-card">
                  <dt>
                    Accessibility Needs
                  </dt>

                  <dd>
                    {fieldValue(
                      event.accessibility_requirements
                    )}
                  </dd>
                </div>

                <div className="requirement-card full">
                  <dt>
                    Special Arrangements
                  </dt>

                  <dd>
                    {fieldValue(
                      event.special_arrangements
                    )}
                  </dd>
                </div>

              </dl>

            </section>

            {/* Registration */}
            <section className="detail-section">

              <div className="detail-section-heading">
                <span className="detail-section-number">
                  4
                </span>

                <h2>
                  Registration & Coordination
                </h2>
              </div>

              <dl className="detail-grid-4">

                <div className="summary-card">
                  <dt>
                    Registration Required
                  </dt>

                  <dd>
                    {event.registration_required == null
                      ? 'Not specified'
                      : event.registration_required
                        ? 'Yes'
                        : 'No'}
                  </dd>
                </div>

                <div className="summary-card">
                  <dt>
                    Registration Capacity
                  </dt>

                  <dd>
                    {fieldValue(
                      event.registration_capacity
                    )}
                  </dd>
                </div>

                <div className="summary-card">
                  <dt>
                    Organiser
                  </dt>

                  <dd>
                    {fieldValue(
                      event.organiser_name
                    )}
                  </dd>
                </div>

                <div className="summary-card">
                  <dt>
                    Coordinator
                  </dt>

                  <dd>
                    {fieldValue(
                      event.coordinator_name
                    )}
                  </dd>
                </div>

              </dl>

            </section>

          </div>

        </div>
      </div>
    </>
  );
}

const styles = `
  .event-detail-page {
    min-height: 100vh;
    width: 100%;
    box-sizing: border-box;
    padding: 40px;
    background: #f7f8fb;
    color: #101828;
  }

  .event-detail-container {
    width: 100%;
    box-sizing: border-box;
  }

  .event-back-link {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 26px;
    color: #475467;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    transition: color 0.2s;
  }

  .event-back-link:hover {
    color: #2563eb;
  }

  .back-arrow {
    font-size: 18px;
    line-height: 1;
  }

  .event-success {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 24px;
    padding: 13px 16px;
    border: 1px solid #bbf7d0;
    border-radius: 10px;
    background: #f0fdf4;
    color: #15803d;
    font-size: 14px;
    font-weight: 500;
  }

  .success-icon {
    display: flex;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #dcfce7;
    color: #15803d;
    font-size: 13px;
    font-weight: 700;
  }

  .event-detail-card {
    width: 100%;
    box-sizing: border-box;
    padding: 34px;
    border: 1px solid #e4e7ec;
    border-radius: 14px;
    background: #ffffff;
    box-shadow: 0 2px 8px rgba(16, 24, 40, 0.04);
  }

  .event-card-header {
    margin-bottom: 32px;
    padding-bottom: 28px;
    border-bottom: 1px solid #eaecf0;
  }

  .event-title-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
  }

  .event-detail-title {
    margin: 0;
    color: #101828;
    font-size: 34px;
    font-weight: 700;
    line-height: 1.2;
  }

  .event-request-id {
    margin: 9px 0 0;
    color: #667085;
    font-size: 14px;
  }

  .event-status {
    display: inline-flex;
    align-items: center;
    padding: 7px 14px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
  }

  .status-submitted {
    border: 1px solid #bbf7d0;
    background: #dcfce7;
    color: #15803d;
  }

  .status-draft {
    border: 1px solid #fde68a;
    background: #fef3c7;
    color: #b45309;
  }

  .status-approved {
    border: 1px solid #bbf7d0;
    background: #dcfce7;
    color: #15803d;
  }

  .status-pending {
    border: 1px solid #fde68a;
    background: #fef3c7;
    color: #b45309;
  }

  .status-rejected {
    border: 1px solid #fecaca;
    background: #fee2e2;
    color: #b91c1c;
  }

  .detail-section {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 32px;
    padding-bottom: 32px;
    border-bottom: 1px solid #eaecf0;
  }

  .detail-section:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .detail-section-heading {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 24px;
  }

  .detail-section-number {
    display: flex;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #dbeafe;
    color: #2563eb;
    font-weight: 700;
  }

  .detail-section-heading h2 {
    margin: 0;
    color: #101828;
    font-size: 19px;
    font-weight: 700;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 40px;
    row-gap: 24px;
  }

  .detail-full {
    grid-column: 1 / -1;
  }

  .detail-item dt {
    margin-bottom: 6px;
    color: #667085;
    font-size: 13px;
    font-weight: 600;
  }

  .detail-item dd {
    margin: 0;
    color: #101828;
    font-size: 15px;
    line-height: 1.6;
  }

  .detail-grid-5 {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 16px;
  }

  .detail-grid-4 {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .summary-card {
    min-width: 0;
    box-sizing: border-box;
    padding: 17px;
    border: 1px solid #eef2f6;
    border-radius: 10px;
    background: #f8fafc;
  }

  .summary-card dt {
    margin-bottom: 7px;
    color: #667085;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .summary-card dd {
    margin: 0;
    overflow-wrap: anywhere;
    color: #101828;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
  }

  .requirement-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .requirement-card {
    box-sizing: border-box;
    padding: 20px;
    border: 1px solid #e4e7ec;
    border-radius: 10px;
    background: #f9fafb;
  }

  .requirement-card.full {
    grid-column: 1 / -1;
  }

  .requirement-card dt {
    margin-bottom: 8px;
    color: #475467;
    font-size: 14px;
    font-weight: 600;
  }

  .requirement-card dd {
    margin: 0;
    white-space: pre-wrap;
    color: #101828;
    font-size: 15px;
    line-height: 1.6;
  }

  .detail-state-page {
    min-height: 60vh;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 40px;
    background: #f7f8fb;
  }

  .detail-state-card {
    padding: 16px 24px;
    border: 1px solid #e4e7ec;
    border-radius: 12px;
    background: white;
    color: #475467;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(16, 24, 40, 0.04);
  }

  .detail-error {
    border-color: #fecaca;
    background: #fef2f2;
    color: #b42318;
  }

  @media (max-width: 1100px) {
    .detail-grid-5 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .detail-grid-4 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 768px) {
    .event-detail-page {
      padding: 24px 14px;
    }

    .event-detail-card {
      padding: 22px;
    }

    .event-detail-title {
      font-size: 28px;
    }

    .event-title-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
}
    }

    .detail-grid,
    .detail-grid-5,
    .detail-grid-4,
    .requirement-grid {
      grid-template-columns: 1fr;
    }

    .detail-full,
    .requirement-card.full {
      grid-column: auto;
    }
  }
`;