import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

// Covers: Event Request Creation + Draft Event Requests.
export default function EventForm() {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    purpose: '',
    description: '',
    eventType: '',
    proposedDate: '',
    proposedStartTime: '',
    proposedEndTime: '',
    expectedAttendance: '',
    roomLayoutPreference: '',
    registrationRequired: false,
    registrationCapacity: '',
    programmeDetails: '',
    specialArrangements: '',
    equipmentNotes: '',
    accessibilityText: '',
  });

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((f) => ({
      ...f,
      [field]: value,
    }));
  }

  function isFormComplete() {
    const requiredFields = [
      'name',
      'purpose',
      'description',
      'eventType',
      'proposedDate',
      'proposedStartTime',
      'proposedEndTime',
      'expectedAttendance',
      'roomLayoutPreference',
      'programmeDetails',
      'specialArrangements',
      'equipmentNotes',
      'accessibilityText',
    ];

    const allRequiredFieldsFilled = requiredFields.every((field) => {
      const value = form[field];

      return value !== null &&
        value !== undefined &&
        String(value).trim() !== '';
    });

    const registrationValid =
      !form.registrationRequired ||
      String(form.registrationCapacity).trim() !== '';

    return allRequiredFieldsFilled && registrationValid;
  }

  async function submit(isDraft) {
    setError('');

    if (busy) return;

    if (!isDraft && !isFormComplete()) {
      setError(
        '⚠️ Please complete all fields before submitting the event request'
      );
      return;
    }

    setBusy(true);

    try {
      const payload = {
        ...form,

        accessibilityRequirements: form.accessibilityText
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),

        expectedAttendance: form.expectedAttendance
          ? Number(form.expectedAttendance)
          : null,

        registrationCapacity: form.registrationCapacity
          ? Number(form.registrationCapacity)
          : null,

        isDraft,
      };

      const data = await api.post('/events', payload, token);

      navigate(`/organizer/events/${data.event.id}`, {
        state: {
          message: data.message,
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <style>{`
        .event-form-page {
          min-height: 100vh;
          width: 100%;
          box-sizing: border-box;
          background: #f7f8fb;
          padding: 40px;
        }

        .event-form-container {
          width: 100%;
          max-width: none;
          margin: 0;
          box-sizing: border-box;
        }

        .event-form-container form {
          width: 100% !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 0 !important;
          box-sizing: border-box;
        }

        .event-form-header {
          margin-bottom: 28px;
        }

        .event-form-eyebrow {
          margin: 0 0 6px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #667085;
        }

        .event-form-header h1 {
          margin: 0;
          font-size: 32px;
          color: #101828;
        }

        .event-form-subtitle {
          margin-top: 10px;
          line-height: 1.6;
          color: #667085;
        }

        .main-form-card {
          width: 100%;
          box-sizing: border-box;
          padding: 34px;
          border: 1px solid #e4e7ec;
          border-radius: 14px;
          background: white;
          box-shadow: 0 2px 8px rgba(16, 24, 40, 0.04);
        }

        .form-section {
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 32px;
          padding-bottom: 32px;
          border-bottom: 1px solid #eaecf0;
        }

        .form-section:last-of-type {
          margin-bottom: 20px;
          padding-bottom: 0;
          border-bottom: none;
        }

        .section-heading {
          display: flex;
          gap: 14px;
          align-items: center;
          margin-bottom: 24px;
        }

        .section-number {
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

        .section-heading h2 {
          margin: 0;
          font-size: 19px;
          color: #101828;
        }

        .section-heading p {
          margin: 5px 0 0;
          font-size: 14px;
          color: #667085;
        }

        .form-grid {
          display: grid;
          width: 100%;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
        }

        .form-grid.three-column {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin-bottom: 20px;
        }

        .form-group {
          display: flex;
          min-width: 0;
          flex-direction: column;
          margin-bottom: 20px;
        }

        .form-group:last-child {
          margin-bottom: 0;
        }

        .full-width {
          grid-column: 1 / -1;
        }

        .form-group label {
          margin-bottom: 7px;
          font-size: 14px;
          font-weight: 600;
          color: #344054;
        }

        .required {
          margin-left: 4px;
          color: #d92d20;
        }

        .form-group input,
        .form-group textarea,
        .form-group select {
          width: 100% !important;
          max-width: none !important;
          box-sizing: border-box;
          padding: 11px 13px;
          border: 1px solid #d0d5dd;
          border-radius: 8px;
          background: white;
          font: inherit;
          font-size: 14px;
          color: #101828;
          transition: 0.2s;
        }

        .form-group textarea {
          resize: vertical;
        }

        .form-group input::placeholder,
        .form-group textarea::placeholder {
          color: #98a2b3;
        }

        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
        }

        .field-hint {
          margin-top: 6px;
          font-size: 12px;
          color: #98a2b3;
        }

        .registration-card {
          display: flex;
          width: 100%;
          box-sizing: border-box;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding: 18px;
          border: 1px solid #eaecf0;
          border-radius: 10px;
          background: #f9fafb;
        }

        .registration-card strong {
          font-size: 14px;
          color: #101828;
        }

        .registration-card p {
          margin: 4px 0 0;
          font-size: 13px;
          color: #667085;
        }

        .registration-capacity {
          max-width: 450px;
          margin-top: 20px;
        }

        .switch {
          position: relative;
          display: inline-block;
          width: 46px;
          height: 26px;
          flex-shrink: 0;
        }

        .switch input {
          width: 0 !important;
          height: 0;
          opacity: 0;
        }

        .slider {
          position: absolute;
          inset: 0;
          cursor: pointer;
          border-radius: 100px;
          background: #d0d5dd;
          transition: 0.25s;
        }

        .slider::before {
          position: absolute;
          bottom: 3px;
          left: 3px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          content: "";
          transition: 0.25s;
          box-shadow: 0 1px 3px rgba(16, 24, 40, 0.25);
        }

        .switch input:checked + .slider {
          background: #2563eb;
        }

        .switch input:checked + .slider::before {
          transform: translateX(20px);
        }

        .form-error {
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 20px;
          padding: 12px 14px;
          border: 1px solid #fecdca;
          border-radius: 8px;
          background: #fef3f2;
          font-size: 14px;
          color: #b42318;
        }

        .form-actions {
          display: flex;
          width: 100%;
          justify-content: flex-end;
          gap: 12px;
          padding-top: 8px;
        }

        .form-actions button {
          min-width: 150px;
          padding: 11px 18px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: 0.15s;
        }

        .button-secondary {
          border: 1px solid #d0d5dd;
          background: white;
          color: #344054;
        }

        .button-secondary:hover:not(:disabled) {
          background: #f9fafb;
        }

        .button-primary {
          border: 1px solid #2563eb;
          background: #2563eb;
          color: white;
        }

        .button-primary:hover:not(:disabled) {
          background: #2563eb;
          box-shadow: 0 3px 8px rgba(79, 70, 229, 0.25);
        }

        .form-actions button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        @media (max-width: 900px) {
          .form-grid.three-column {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 768px) {
          .event-form-page {
            padding: 24px 14px;
          }

          .main-form-card {
            padding: 22px;
          }

          .form-grid,
          .form-grid.three-column {
            grid-template-columns: 1fr;
          }

          .full-width {
            grid-column: auto;
          }

          .form-actions {
            flex-direction: column-reverse;
          }

          .form-actions button {
            width: 100%;
          }
        }
      `}</style>

      <div className="event-form-page">
        <div className="event-form-container">

          <div className="event-form-header">

            <h1>New Event Request</h1>

            <p className="event-form-subtitle">
              Provide the details below to submit a new event request.
              You can also save your progress as a draft.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();

              submit(
                e.nativeEvent.submitter?.value === 'draft'
              );
            }}
          >

            <div className="main-form-card">

              {/* Event Information */}
              <section className="form-section">

                <div className="section-heading">
                  <span className="section-number">1</span>

                  <div>
                    <h2>Event Information</h2>
                  </div>
                </div>

                <div className="form-grid">

                  <div className="form-group full-width">
                    <label htmlFor="name">
                      Event name
                    </label>

                    <input
                      id="name"
                      value={form.name}
                      onChange={(e) =>
                        update('name', e.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="purpose">
                      Purpose
                    </label>

                    <input
                      id="purpose"
                      value={form.purpose}
                      onChange={(e) =>
                        update('purpose', e.target.value)
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="eventType">
                      Event type
                    </label>

                    <select
                      id="eventType"
                      value={form.eventType}
                      onChange={(e) =>
                        update('eventType', e.target.value)
                      }
                    >
                      <option value="">
                        Select event type
                      </option>
                      <option value="Conference">
                        Conference
                      </option>
                      <option value="Seminar">
                        Seminar
                      </option>
                      <option value="Workshop">
                        Workshop
                      </option>
                      <option value="Product Launch">
                        Product Launch
                      </option>
                      <option value="Networking">
                        Networking
                      </option>
                      <option value="Exhibition">
                        Exhibition
                      </option>
                      <option value="Other">
                        Other
                      </option>
                    </select>
                  </div>

                  <div className="form-group full-width">
                    <label htmlFor="description">
                      Description
                    </label>

                    <textarea
                      id="description"
                      value={form.description}
                      onChange={(e) =>
                        update('description', e.target.value)
                      }
                      rows={4}
                      placeholder="Short overview of the event"
                    />
                  </div>

                </div>

              </section>


              {/* Date & Attendance */}
              <section className="form-section">

                <div className="section-heading">
                  <span className="section-number">2</span>

                  <div>
                    <h2>Date & Attendance</h2>
                  </div>
                </div>

                <div className="form-grid three-column">

                  <div className="form-group">
                    <label htmlFor="proposedDate">
                      Proposed date
                    </label>

                    <input
                      id="proposedDate"
                      type="date"
                      value={form.proposedDate}
                      onChange={(e) =>
                        update('proposedDate', e.target.value)
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="startTime">
                      Start time
                    </label>

                    <input
                      id="startTime"
                      type="time"
                      value={form.proposedStartTime}
                      onChange={(e) =>
                        update(
                          'proposedStartTime',
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="endTime">
                      End time
                    </label>

                    <input
                      id="endTime"
                      type="time"
                      value={form.proposedEndTime}
                      onChange={(e) =>
                        update(
                          'proposedEndTime',
                          e.target.value
                        )
                      }
                    />
                  </div>

                </div>

                <div className="form-grid">

                  <div className="form-group">
                    <label htmlFor="attendance">
                      Expected attendance
                    </label>

                    <input
                      id="attendance"
                      type="number"
                      min="0"
                      value={form.expectedAttendance}
                      onChange={(e) =>
                        update(
                          'expectedAttendance',
                          e.target.value
                        )
                      }
                      placeholder="e.g. 120"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="layout">
                      Room layout preference
                    </label>

                    <select
                      id="layout"
                      value={form.roomLayoutPreference}
                      onChange={(e) =>
                        update(
                          'roomLayoutPreference',
                          e.target.value
                        )
                      }
                    >
                      <option value="">
                        Select room layout
                      </option>
                      <option value="Theatre">
                        Theatre
                      </option>
                      <option value="Classroom">
                        Classroom
                      </option>
                      <option value="Banquet">
                        Banquet
                      </option>
                      <option value="Boardroom">
                        Boardroom
                      </option>
                      <option value="U-Shape">
                        U-Shape
                      </option>
                      <option value="Open Concept">
                        Open Concept
                      </option>
                    </select>
                  </div>

                </div>

              </section>


              {/* Event Requirements */}
              <section className="form-section">

                <div className="section-heading">
                  <span className="section-number">3</span>

                  <div>
                    <h2>Event Requirements</h2>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="programme">
                    Programme
                  </label>

                  <textarea
                    id="programme"
                    maxLength={10000}
                    value={form.programmeDetails}
                    onChange={(e) =>
                      update(
                        'programmeDetails',
                        e.target.value
                      )
                    }
                    rows={5}
                  />
                </div>

                <div className="form-grid">

                  <div className="form-group">
                    <label htmlFor="equipment">
                      Equipment requirements
                    </label>

                    <textarea
                      id="equipment"
                      maxLength={10000}
                      value={form.equipmentNotes}
                      onChange={(e) =>
                        update(
                          'equipmentNotes',
                          e.target.value
                        )
                      }
                      rows={4}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="accessibility">
                      Accessibility needs
                    </label>

                    <textarea
                      id="accessibility"
                      maxLength={10000}
                      value={form.accessibilityText}
                      onChange={(e) =>
                        update(
                          'accessibilityText',
                          e.target.value
                        )
                      }
                      rows={4}
                    />

                    <span className="field-hint">
                      Enter one requirement per line.
                    </span>
                  </div>

                </div>

                <div className="form-group">
                  <label htmlFor="special">
                    Special arrangements
                  </label>

                  <textarea
                    id="special"
                    maxLength={10000}
                    value={form.specialArrangements}
                    onChange={(e) =>
                      update(
                        'specialArrangements',
                        e.target.value
                      )
                    }
                    rows={3}
                    placeholder="Add any other arrangements or notes"
                  />
                </div>

              </section>


              {/* Registration */}
              <section className="form-section">

                <div className="section-heading">
                  <span className="section-number">4</span>

                  <div>
                    <h2>Registration</h2>
                  </div>
                </div>

                <div className="registration-card">

                  <div>
                    <strong>
                      Attendee registration
                    </strong>

                    <p>
                      Enable this if attendees must register before
                      attending.
                    </p>
                  </div>

                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={form.registrationRequired}
                      onChange={(e) =>
                        update(
                          'registrationRequired',
                          e.target.checked
                        )
                      }
                    />

                    <span className="slider" />
                  </label>

                </div>

                {form.registrationRequired && (
                  <div className="registration-capacity">

                    <div className="form-group">
                      <label htmlFor="capacity">
                        Registration capacity
                      </label>

                      <input
                        id="capacity"
                        type="number"
                        min="0"
                        value={form.registrationCapacity}
                        onChange={(e) =>
                          update(
                            'registrationCapacity',
                            e.target.value
                          )
                        }
                        placeholder="Maximum number of registrations"
                      />
                    </div>

                  </div>
                )}

              </section>


              {error && (
                <div
                  role="alert"
                  className="form-error"
                >
                  {error}
                </div>
              )}


              <div className="form-actions">

                <button
                  type="submit"
                  value="draft"
                  className="button-secondary"
                  disabled={busy}
                >
                  Save as draft
                </button>

                <button
                  type="submit"
                  value="submitted"
                  className="button-primary"
                  disabled={busy}
                >
                  {busy
                    ? 'Saving...'
                    : 'Submit request'}
                </button>

              </div>

            </div>

          </form>

        </div>
      </div>
    </>
  );
}