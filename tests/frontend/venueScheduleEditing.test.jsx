import React from 'react';
import { readFileSync } from 'node:fs';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VenueSchedule from '../../frontend/src/pages/venues/VenueSchedule';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
// jsdom does not provide PointerEvent; retain MouseEvent coordinates and explicit pointer identity for multi-pointer cases.
beforeEach(() => { window.PointerEvent = class extends MouseEvent {
  constructor(type, options) { super(type, options); this.pointerId = options.pointerId; }
}; });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const date = '2030-10-10';
const venue = { id: 7, name: 'LazadaOne', operating_hours: '08:00 - 22:00', setup_minutes: 0, turnaround_minutes: 0 };
const recorded = { id: 3, kind: 'schedule', status: 'unavailable', label: 'Cleaning',
  start_datetime: `${date}T10:00:00+08:00`, end_datetime: `${date}T11:00:00+08:00` };

it('AC9 - an unavailable block fills its timeline row vertically', async () => {
  // Arrange: apply the real production stylesheet because jsdom does not load Vite CSS automatically.
  const style = document.createElement('style');
  style.textContent = readFileSync('src/index.css', 'utf8');
  document.head.append(style);
  try {
    api.get.mockResolvedValue([recorded]);
    render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
    // Act: inspect the same unavailability block that staff can drag.
    const block = await screen.findByLabelText('Cleaning 10:00–11:00');
    // Assert: inset positioning would leave the bar floating inside the row again.
    expect(getComputedStyle(block).top).toBe('0px');
    expect(getComputedStyle(block).bottom).toBe('0px');
    expect(getComputedStyle(block).height).not.toMatch(/^\d+px$/);
  } finally {
    style.remove();
  }
});

it('AC7 AC10 - the timeline owns editing and shows a saved unavailability reason on its block', async () => {
  // Arrange: staff open a day without recorded closures; no separate agenda or time-entry form is needed.
  api.get.mockResolvedValue([]);
  api.put.mockResolvedValue({});
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  expect(screen.queryByRole('list', { name: 'Daily availability' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Mark on timeline')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('New period start')).not.toBeInTheDocument();
  // Act: drag an unavailable block, write its short reason in the timeline, and save.
  fireEvent.pointerDown(row, { clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 440, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 440, pointerId: 1 });
  fireEvent.change(screen.getByLabelText('Reason unavailable'), { target: { value: 'Floor cleaning' } });
  expect(screen.getByLabelText('Floor cleaning 10:00–11:00')).toHaveTextContent('Floor cleaning');
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert: a label kept only in the input or omitted from persistence would fail.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/venues/7/schedule',
    { date, periods: [{ status: 'unavailable', start: '10:00', end: '11:00', label: 'Floor cleaning' }] }, 'staff'));
});

it.each([
  ['missing status', { status: '' }, 'needs a status'],
  ['reversed times', { start_datetime: `${date}T11:00:00+08:00`, end_datetime: `${date}T10:00:00+08:00` }, 'must end later'],
])('AC5 - a loaded period with %s cannot be resaved', async (_, change, expected) => {
  // Arrange: legacy or damaged data is still rejected before it can be republished.
  api.get.mockResolvedValue([{ ...recorded, ...change }]);
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  // Act
  await screen.findByRole('row', { name: /LazadaOne timeline/i });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert
  expect(screen.getByRole('alert')).toHaveTextContent(expected);
  expect(api.put).not.toHaveBeenCalled();
});

it('AC5 - a drag ending at the visual 24:00 boundary cannot save an invalid clock time', async () => {
  // Arrange: 24:00 is shown on the axis but is not an accepted persisted HH:mm value.
  api.get.mockResolvedValue([]);
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  // Act
  fireEvent.pointerDown(row, { clientX: 940, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 960, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 960, pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert: the out-of-day draft is not sent to PostgreSQL.
  expect(screen.getByRole('alert')).toHaveTextContent('must end later');
  expect(api.put).not.toHaveBeenCalled();
});

it('AC10 AC11 - existing blocks can be selected by click or keyboard to edit their reasons', async () => {
  // Arrange: two descriptions make an incorrect block selection observable.
  api.get.mockResolvedValue([recorded, { ...recorded, id: 4, label: 'Painting',
    start_datetime: `${date}T13:00:00+08:00`, end_datetime: `${date}T14:00:00+08:00` }]);
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const first = await screen.findByLabelText('Cleaning 10:00–11:00');
  const second = screen.getByLabelText('Painting 13:00–14:00');
  // Act / Assert: unrelated keys do not switch blocks; Enter and Space do.
  fireEvent.click(first);
  expect(screen.getByLabelText('Reason unavailable')).toHaveValue('Cleaning');
  fireEvent.keyDown(second, { key: 'Escape' });
  expect(screen.getByLabelText('Reason unavailable')).toHaveValue('Cleaning');
  fireEvent.keyDown(second, { key: 'Enter' });
  expect(screen.getByLabelText('Reason unavailable')).toHaveValue('Painting');
  fireEvent.keyDown(first, { key: ' ' });
  fireEvent.change(screen.getByLabelText('Reason unavailable'), { target: { value: 'Floor cleaning' } });
  expect(screen.getByLabelText('Floor cleaning 10:00–11:00')).toHaveAttribute('title', 'Floor cleaning 10:00–11:00');
  expect(screen.getByLabelText('Painting 13:00–14:00')).toBeVisible();
});

it('AC3 AC7 AC9 - shows a venue row on a horizontal day axis and closes time outside operating hours', async () => {
  // Arrange: an empty day has no explicit periods.
  api.get.mockResolvedValue([]);
  // Act
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  // Assert: the selected venue is the only row; closed time is never displayed as available.
  expect(await screen.findByRole('row', { name: /LazadaOne timeline/i })).toBeVisible();
  expect(screen.getByRole('gridcell', { name: /00:00–08:00.*Unavailable/ })).toBeVisible();
  expect(screen.getByRole('gridcell', { name: /08:00–22:00.*Available/ })).toBeVisible();
  expect(screen.getByRole('gridcell', { name: /22:00–24:00.*Unavailable/ })).toBeVisible();
  expect(screen.getByText('08:00', { selector: '.venue-timeline-tick' })).toBeVisible();
});

it('AC1 AC10 - dragging across the row creates an unavailable block that staff can save', async () => {
  // Arrange: at a 960px width each pixel is 1.5 minutes; 400–440 maps to 10:00–11:00.
  api.get.mockResolvedValue([]);
  api.put.mockResolvedValue({ message: 'Venue schedule saved.' });
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  // Act
  fireEvent.pointerDown(row, { clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 440, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 440, pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert: a missing drag handler or wrong coordinate conversion would send different times.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/venues/7/schedule',
    { date, periods: [{ status: 'unavailable', start: '10:00', end: '11:00', label: '' }] }, 'staff'));
});

it('AC10 - drag endpoints snap just below, at and above the 30-minute midpoint', async () => {
  // Arrange: x=440 marks 11:00 on the 960px day row; x=450 is halfway to the next 30-minute slot.
  api.get.mockResolvedValue([]);
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  // Act / Assert: below midpoint rounds down, midpoint and above round up.
  for (const [x, end] of [[449, '11:00'], [450, '11:30'], [451, '11:30']]) {
    fireEvent.pointerDown(row, { clientX: 400, pointerId: x });
    fireEvent.pointerMove(row, { clientX: x, pointerId: x });
    fireEvent.pointerUp(row, { clientX: x, pointerId: x });
    expect(screen.getByLabelText(`unavailable 10:00–${end}`)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Delete unavailable period' }));
  }
});

it('AC10 AC11 - a click creates at least 30 minutes and resizing never shrinks below one step', async () => {
  // Arrange: a one-point gesture must produce a usable half-hour block.
  api.get.mockResolvedValue([]);
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  // Act / Assert: creation and right-edge resizing both respect the same minimum duration.
  fireEvent.pointerDown(row, { clientX: 400, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 400, pointerId: 1 });
  const block = screen.getByLabelText('unavailable 10:00–10:30');
  fireEvent.pointerDown(block.querySelector('[data-edge="right"]'), { clientX: 420, pointerId: 2 });
  fireEvent.pointerMove(row, { clientX: 400, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 400, pointerId: 2 });
  expect(screen.getByLabelText('unavailable 10:00–10:30')).toBeVisible();
});

it('AC11 - moving and resizing an existing block follows 30-minute steps', async () => {
  // Arrange: a stored one-hour closure can be moved or adjusted without entering clock text.
  api.get.mockResolvedValue([recorded]);
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  const block = await screen.findByLabelText('Cleaning 10:00–11:00');
  // Act: 20 pixels on the 960-pixel day row is one half-hour step.
  fireEvent.pointerDown(block, { clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 420, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 420, pointerId: 1 });
  const moved = screen.getByLabelText('Cleaning 10:30–11:30');
  fireEvent.pointerDown(moved.querySelector('[data-edge="right"]'), { clientX: 460, pointerId: 2 });
  fireEvent.pointerMove(row, { clientX: 480, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 480, pointerId: 2 });
  // Assert: both transformations land on adjacent half-hour boundaries.
  expect(screen.getByLabelText('Cleaning 10:30–12:00')).toBeVisible();
});

it('AC2 AC11 - existing blocks can be moved resized and deleted before replacement save', async () => {
  // Arrange: a saved 10:00–11:00 block is editable.
  api.get.mockResolvedValue([recorded]);
  api.put.mockResolvedValue({ message: 'Venue schedule saved.' });
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  const block = await screen.findByLabelText(/Cleaning 10:00–11:00/);
  // Act: move it one hour, then resize its right edge one hour.
  fireEvent.pointerDown(block, { clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 440, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 440, pointerId: 1 });
  const moved = screen.getByLabelText(/Cleaning 11:00–12:00/);
  fireEvent.pointerDown(moved.querySelector('[data-edge="right"]'), { clientX: 480, pointerId: 2 });
  fireEvent.pointerMove(row, { clientX: 520, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 520, pointerId: 2 });
  expect(screen.getByLabelText(/Cleaning 11:00–13:00/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Delete Cleaning period/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert: deleting the final block replaces the day with an empty explicit schedule.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/venues/7/schedule', { date, periods: [] }, 'staff'));
});

it('AC4 AC5 AC6 - invalid edits show errors and confirmed booking conflicts list affected events', async () => {
  // Arrange: the API refuses a proposed closure over a confirmed booking.
  api.get.mockResolvedValue([]);
  api.put.mockRejectedValue({ message: 'The proposed unavailable period overlaps confirmed bookings.',
    details: { affectedBookings: [{ booking_id: 9, event_name: 'Gala', status: 'approved',
      start_datetime: `${date}T10:00:00+08:00`, end_datetime: `${date}T11:00:00+08:00` }] } });
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  await screen.findByRole('row', { name: /LazadaOne timeline/i });
  // Act / Assert: a drag starting before opening cannot be saved.
  const row = screen.getByRole('row', { name: /LazadaOne timeline/i });
  fireEvent.pointerDown(row, { clientX: 300, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 360, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 360, pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('08:00–22:00');
  expect(api.put).not.toHaveBeenCalled();
  // Act: replace it with an in-hours closure; the server has the final booking decision.
  fireEvent.click(screen.getByRole('button', { name: 'Delete unavailable period' }));
  fireEvent.pointerDown(row, { clientX: 400, pointerId: 2 });
  fireEvent.pointerMove(row, { clientX: 440, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 440, pointerId: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert: the booking's identity is visible and the change is unsaved.
  expect(await screen.findByText('Gala')).toBeVisible();
});

it('AC4 AC5 - missing date and overlapping timeline edits show errors before persistence', async () => {
  // Arrange: staff start with a recorded operating window and an empty selected day.
  api.get.mockResolvedValue([]);
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  await screen.findByRole('row', { name: /LazadaOne timeline/i });
  // Act / Assert: a second drag crossing the first block must not be persisted.
  const row = screen.getByRole('row', { name: /LazadaOne timeline/i });
  fireEvent.pointerDown(row, { clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 440, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 440, pointerId: 1 });
  fireEvent.pointerDown(row, { clientX: 360, pointerId: 2 });
  fireEvent.pointerMove(row, { clientX: 420, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 420, pointerId: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect(screen.getByRole('alert')).toHaveTextContent('cannot overlap');
  expect(api.put).not.toHaveBeenCalled();
  // Clearing the date must also block Save.
  fireEvent.change(screen.getByLabelText('Schedule date'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a schedule date');
});

it('AC1 AC7 AC10 - selected blocks support availability overrides and descriptions through save failures', async () => {
  // Arrange: a fresh day supports explicit available records even though open hours default available.
  api.get.mockResolvedValue([]);
  api.put.mockRejectedValueOnce({}).mockResolvedValueOnce({});
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  await screen.findByRole('row', { name: /LazadaOne timeline/i });
  // Act: drag a block, then change its status and description within the timeline.
  const row = screen.getByRole('row', { name: /LazadaOne timeline/i });
  fireEvent.pointerDown(row, { clientX: 320, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 360, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 360, pointerId: 1 });
  fireEvent.change(screen.getByLabelText('Period availability'), { target: { value: 'available' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Open house' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert: transport failure does not claim a saved schedule or discard the draft.
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save the schedule');
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/venues/7/schedule',
    { date, periods: [{ status: 'available', start: '08:00', end: '09:00', label: 'Open house' }] }, 'staff'));
});

it('AC5 - a venue without recorded operating hours cannot accept schedule edits', async () => {
  // Arrange
  api.get.mockResolvedValue([]);
  render(<VenueSchedule venue={{ id: 7, name: 'Legacy hall' }} token="staff" canEdit initialDate={date} />);
  // Act
  await screen.findByRole('row', { name: /Legacy hall timeline/i });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert
  expect(screen.getByRole('alert')).toHaveTextContent('Record valid operating hours');
  expect(api.put).not.toHaveBeenCalled();
});

it('AC2 AC11 - left resizing and editing one of two saved blocks retains the other block', async () => {
  // Arrange: two stored periods make unintended replacement of a neighboring block observable.
  api.get.mockResolvedValue([recorded, { ...recorded, id: 4, label: 'unavailable',
    start_datetime: `${date}T13:00:00+08:00`, end_datetime: `${date}T14:00:00+08:00` }]);
  api.put.mockResolvedValue({});
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  const capture = vi.fn();
  row.setPointerCapture = capture;
  // Act: a stray pointer release does nothing, then dragging the left handle extends Cleaning to 09:30.
  fireEvent.pointerUp(row, { clientX: 400, pointerId: 1 });
  fireEvent.pointerDown((await screen.findByLabelText(/Cleaning 10:00–11:00/)).querySelector('[data-edge="left"]'), { clientX: 400, pointerId: 2 });
  fireEvent.pointerMove(row, { clientX: 380, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 380, pointerId: 2 });
  expect(capture).toHaveBeenCalledOnce();
  expect(screen.getByLabelText(/Cleaning 09:30–11:00/)).toBeVisible();
  expect(screen.getByLabelText(/unavailable 13:00–14:00/)).toBeVisible();
  // Act: the selected block status and further handle drags must not alter its neighbor.
  fireEvent.change(screen.getByLabelText('Period availability'), { target: { value: 'available' } });
  fireEvent.pointerDown(screen.getByLabelText(/Cleaning 09:30–11:00/).querySelector('[data-edge="left"]'), { clientX: 380, pointerId: 3 });
  fireEvent.pointerMove(row, { clientX: 360, pointerId: 3 });
  fireEvent.pointerUp(row, { clientX: 360, pointerId: 3 });
  fireEvent.pointerDown(screen.getByLabelText(/Cleaning 09:00–11:00/).querySelector('[data-edge="right"]'), { clientX: 440, pointerId: 4 });
  fireEvent.pointerMove(row, { clientX: 460, pointerId: 4 });
  fireEvent.pointerUp(row, { clientX: 460, pointerId: 4 });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  // Assert: both statuses and the exact edited time reach the replacement API.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/venues/7/schedule', { date, periods: [
    { status: 'available', start: '09:00', end: '11:30', label: 'Cleaning' },
    { status: 'unavailable', start: '13:00', end: '14:00', label: '' },
  ] }, 'staff'));
});

it('AC9 AC10 - accidental second pointer and out-of-day records do not create extra timeline blocks', async () => {
  // Arrange: the API's stray adjacent-day record must not appear on this venue's day row.
  api.get.mockResolvedValue([{ id: 55, kind: 'booking', status: 'approved', label: 'Tomorrow',
    start_datetime: '2030-10-11T10:00:00+08:00', end_datetime: '2030-10-11T11:00:00+08:00' }]);
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const row = await screen.findByRole('row', { name: /LazadaOne timeline/i });
  expect(row.querySelector('.venue-timeline-locked')).toBeNull();
  // Act: a second pointer cannot replace or finish the first pointer's drag.
  fireEvent.pointerDown(row, { clientX: 400, pointerId: 1 });
  fireEvent.pointerDown(row, { clientX: 600, pointerId: 2 });
  fireEvent.pointerMove(row, { clientX: 600, pointerId: 2 });
  fireEvent.pointerCancel(row, { clientX: 600, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 600, pointerId: 2 });
  fireEvent.pointerMove(row, { clientX: 440, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 440, pointerId: 1 });
  const deleteButton = screen.getByRole('button', { name: 'Delete unavailable period' });
  fireEvent.pointerDown(deleteButton, { clientX: 420, pointerId: 3 });
  fireEvent.pointerUp(row, { clientX: 420, pointerId: 3 });
  fireEvent.pointerDown(row, { clientX: 500, pointerId: 4, button: 2 });
  fireEvent.pointerUp(row, { clientX: 500, pointerId: 4 });
  fireEvent.pointerDown(row, { clientX: 600, pointerId: 5 });
  fireEvent.pointerMove(row, { clientX: 640, pointerId: 5 });
  fireEvent.pointerCancel(row, { clientX: 640, pointerId: 5 });
  fireEvent.pointerMove(row, { clientX: 660, pointerId: 5 });
  // Assert: only the first deliberate drag created a block.
  expect(screen.getAllByLabelText(/unavailable 10:00–11:00/)).toHaveLength(1);
});

it('AC7 AC9 - timeline shows confirmed occupancy with buffers and hides expired holds', async () => {
  // Arrange: one approved booking needs 30 minutes of setup and 15 minutes of turnaround;
  // a past pending hold is no longer a blocker, while a future hold still is.
  api.get.mockResolvedValue([
    { id: 10, kind: 'booking', status: 'approved', label: 'Confirmed gala', setup_minutes: 30, turnaround_minutes: 15,
      start_datetime: `${date}T10:00:00+08:00`, end_datetime: `${date}T11:00:00+08:00` },
    { id: 11, kind: 'booking', status: 'pending', label: 'Expired hold', hold_expires_at: '2020-01-01T00:00:00Z',
      start_datetime: `${date}T11:00:00+08:00`, end_datetime: `${date}T12:00:00+08:00` },
    { id: 12, kind: 'booking', status: 'pending', label: 'Live hold', hold_expires_at: '2040-01-01T00:00:00Z',
      start_datetime: `${date}T12:00:00+08:00`, end_datetime: `${date}T13:00:00+08:00` },
  ]);
  // Act
  render(<VenueSchedule venue={venue} token="staff" canEdit initialDate={date} />);
  const confirmed = await screen.findByTitle('Confirmed gala');
  // Assert: the visual span starts at 09:30 and ends at 11:15 on the 24-hour axis.
  expect(parseFloat(confirmed.style.left)).toBeCloseTo(570 / 14.4);
  expect(parseFloat(confirmed.style.width)).toBeCloseTo(105 / 14.4);
  expect(screen.queryByTitle('Expired hold')).not.toBeInTheDocument();
  expect(screen.getByTitle('Live hold')).toBeVisible();
});
