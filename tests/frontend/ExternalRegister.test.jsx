// File: Verifies retained external registration, role boundaries and submission feedback.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import ExternalRegister from '../../frontend/src/pages/external/ExternalRegister';
afterEach(() => { // Cleans rendered forms and API mocks between cases.
  cleanup(); vi.restoreAllMocks();
});
// Test case: Submits external signup and checks chosen external role data while staff role choices stay unavailable.
it('registers external accounts while keeping staff roles unavailable', async () => {
  // Checks the real form payload, success response and supported sign-in action.
  const post = vi.spyOn(api, 'post').mockResolvedValue({ message: 'Account created. Please sign in.' });
  render(<MemoryRouter><ExternalRegister /></MemoryRouter>);
  expect(screen.getAllByRole('option').map(option => option.value)).toEqual(['attendee', 'event_organiser']);
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Person' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => { // Waits for the successful creation message.
    expect(screen.getByRole('status').textContent).toMatch(/Account created/);
  });
  expect(post).toHaveBeenCalledWith('/auth/register', { fullName: 'New Person', email: 'new@example.com', password: 'password123', confirmation: 'password123', role: 'attendee', organisationName: null });
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/external/login');
});
// Test case: Fails registration and checks entered values are retained alongside the error.
it('retains entered fields and displays registration errors', async () => {
  // Checks confirmation mismatch and duplicate-email feedback without losing the input.
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('An account with that email already exists.'));
  render(<MemoryRouter><ExternalRegister /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Person' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByRole('alert').textContent).toMatch(/do not match/); expect(post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => { // Waits for the server error to appear.
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/);
  });
  expect(screen.getByLabelText('Email').value).toBe('new@example.com');
});
