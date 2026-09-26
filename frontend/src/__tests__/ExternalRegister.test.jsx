import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import ExternalRegister from '../pages/external/ExternalRegister';

vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

function renderPage() {
  render(<MemoryRouter><ExternalRegister /></MemoryRouter>);
}

beforeEach(() => api.post.mockReset());
afterEach(cleanup);

it('submits an event organiser account with its organisation name', async () => {
  api.post.mockResolvedValue({ message: 'Account created.' });
  renderPage();

  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alice Organiser' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('Organisation name'), { target: { value: 'Community Group' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByRole('status')).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/auth/register', expect.objectContaining({
    email: 'alice@example.com',
    role: 'event_organiser',
    organisationName: 'Community Group',
  }));
});

it('offers only external roles and submits the selected attendee account', async () => {
  api.post.mockResolvedValue({ message: 'Account created.' });
  renderPage();

  expect(screen.getByRole('button', { name: /event organiser/i })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /attendee/i }));
  expect(screen.queryByLabelText('Organisation name')).toBeNull();

  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alice Attendee' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByRole('status')).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/auth/register', {
    fullName: 'Alice Attendee',
    email: 'alice@example.com',
    password: 'password123',
    role: 'attendee',
    organisationName: '',
  });
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/external/login');
});

it('shows a server error and keeps the registration form available', async () => {
  api.post.mockRejectedValueOnce(new Error('An account with that email already exists.'));
  renderPage();

  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

  expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/);
  expect(screen.getByLabelText('Email')).toBeTruthy();
});
