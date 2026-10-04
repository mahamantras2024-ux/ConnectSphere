import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

export default function EventList() {
  const { token, user } = useAuth();
  const organiser = user.role === 'event_organiser';

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchEvents() {
      try {
        setLoading(true);
        setError('');

        const data = await api.get('/events', token);

        if (isMounted) {
          setEvents(data.events || []);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to load events.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchEvents();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const formatStatus = (status) => {
    if (!status) return 'Draft';

    return (
      status.charAt(0).toUpperCase() +
      status.slice(1)
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
      default:
        return 'status-draft';
    }
  };

  if (loading) {
    return (
      <>
        <style>{styles}</style>

        <div className="event-state-page">
          <div className="event-state-card">
            Loading events...
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <style>{styles}</style>

        <div className="event-state-page">
          <div className="event-state-card event-state-error">
            ⚠️ {error}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>

      <div className="event-list-page">
        <div className="event-list-container">

          {/* Header */}
          <div className="event-list-header">
            <div>

              <h1>
                {organiser ? 'My Events' : 'Events'}
              </h1>

              <p className="event-list-subtitle">
              </p>
            </div>

            {organiser && (
              <Link
                to="/organizer/events/new"
                className="request-event-button"
              >
                <span className="request-event-plus">
                  +
                </span>

                Request an event
              </Link>
            )}
          </div>

          {/* Empty state */}
          {events.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                📅
              </div>

              <h2>
                {organiser
                  ? 'No event requests yet'
                  : 'No events found'}
              </h2>

              <p>
                {organiser
                  ? 'Create your first event request to get started.'
                  : 'There are currently no events available.'}
              </p>

              {organiser && (
                <Link
                  to="/organizer/events/new"
                  className="empty-state-button"
                >
                  Request an event
                </Link>
              )}
            </div>
          ) : (
            <div className="events-grid">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="event-card"
                >
                  <div className="event-card-top">
                    <div className="event-card-title-wrap">
                      <h3>
                        {event.name || 'Untitled Event'}
                      </h3>

                      <span
                        className={`event-status ${getStatusClass(
                          event.status
                        )}`}
                      >
                        {formatStatus(event.status)}
                      </span>
                    </div>
                  </div>

                  <div className="event-card-body">
                    <div className="event-info-block">
                      <span className="event-info-label">
                        Purpose
                      </span>

                      <p>
                        {event.purpose ||
                          'No purpose provided'}
                      </p>
                    </div>
                  </div>

                  <div className="event-card-footer">
                    <Link
                      to={`${organiser
                        ? '/organizer/events'
                        : '/events'
                      }/${event.id}`}
                      className="view-details-link"
                    >
                      View details
                      <span>→</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
}

const styles = `
  .event-list-page {
    min-height: 100vh;
    width: 100%;
    box-sizing: border-box;
    padding: 20px;
    background: #f7f8fb;
    color: #101828;
  }

  .event-list-container {
    width: 100%;
    box-sizing: border-box;
  }

  .event-list-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 25px;
  }

  .event-list-eyebrow {
    margin: 0 0 6px;
    color: #667085;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .event-list-header h1 {
    margin: 0;
    color: #101828;
    font-size: 32px;
    font-weight: 700;
  }

  .event-list-subtitle {
    margin: 8px 0 0;
    color: #667085;
    font-size: 15px;
  }

  .request-event-button,
  .empty-state-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 16px;
    border: 1px solid #2563eb;
    border-radius: 8px;
    background: #2563eb;
    color: white;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    transition: 0.2s;
  }

  .request-event-button:hover,
  .empty-state-button:hover {
    background: #1d4ed8;
    box-shadow: 0 3px 8px rgba(37, 99, 235, 0.2);
  }

  .request-event-plus {
    font-size: 18px;
    line-height: 1;
  }

  .events-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
  }

  .event-card {
    display: flex;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #e4e7ec;
    border-radius: 14px;
    background: white;
    box-shadow: 0 2px 8px rgba(16, 24, 40, 0.04);
    transition:
      transform 0.18s,
      box-shadow 0.18s,
      border-color 0.18s;
  }

  .event-card:hover {
    transform: translateY(-2px);
    border-color: #cbd5e1;
    box-shadow: 0 6px 16px rgba(16, 24, 40, 0.08);
  }

  .event-card-top {
    padding: 22px 22px 16px;
  }

  .event-card-title-wrap {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .event-card-title-wrap h3 {
    margin: 0;
    color: #101828;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.35;
  }

  .event-card-id {
    margin: 7px 0 0;
    color: #98a2b3;
    font-size: 13px;
  }

  .event-status {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
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

  .status-draft {
    border: 1px solid #fde68a;
    background: #fef3c7;
    color: #b45309;
  }

  .status-rejected {
    border: 1px solid #fecaca;
    background: #fee2e2;
    color: #b91c1c;
  }

  .event-card-body {
    flex: 1;
    padding: 0 22px 22px;
  }

  .event-info-block {
    padding-top: 16px;
    border-top: 1px solid #f0f2f5;
  }

  .event-info-label {
    display: block;
    margin-bottom: 6px;
    color: #667085;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .event-info-block p {
    margin: 0;
    display: -webkit-box;
    overflow: hidden;
    color: #344054;
    font-size: 14px;
    line-height: 1.6;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .event-card-footer {
    padding: 15px 22px;
    border-top: 1px solid #eaecf0;
    background: #fcfcfd;
  }

  .view-details-link {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: #2563eb;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
  }

  .view-details-link:hover {
    color: #1d4ed8;
  }

  .view-details-link span {
    transition: transform 0.2s;
  }

  .view-details-link:hover span {
    transform: translateX(3px);
  }

  .empty-state {
    width: 100%;
    box-sizing: border-box;
    padding: 60px 30px;
    border: 1px solid #e4e7ec;
    border-radius: 14px;
    background: white;
    text-align: center;
    box-shadow: 0 2px 8px rgba(16, 24, 40, 0.04);
  }

  .empty-state-icon {
    display: flex;
    width: 54px;
    height: 54px;
    align-items: center;
    justify-content: center;
    margin: 0 auto 18px;
    border-radius: 50%;
    background: #eff6ff;
    font-size: 24px;
  }

  .empty-state h2 {
    margin: 0;
    color: #101828;
    font-size: 20px;
  }

  .empty-state p {
    margin: 9px 0 20px;
    color: #667085;
    font-size: 14px;
  }

  .event-state-page {
    min-height: 60vh;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 40px;
    background: #f7f8fb;
  }

  .event-state-card {
    padding: 16px 24px;
    border: 1px solid #e4e7ec;
    border-radius: 12px;
    background: white;
    color: #475467;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(16, 24, 40, 0.04);
  }

  .event-state-error {
    border-color: #fecaca;
    background: #fef2f2;
    color: #b42318;
  }

  @media (max-width: 900px) {
    .events-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .event-list-page {
      padding: 24px 14px;
    }

    .event-list-header {
      align-items: stretch;
      flex-direction: column;
    }

    .request-event-button {
      width: 100%;
      box-sizing: border-box;
    }

    .event-list-header h1 {
      font-size: 28px;
    }
  }
`;