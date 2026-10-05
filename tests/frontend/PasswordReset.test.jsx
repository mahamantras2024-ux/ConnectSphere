// File: Tests reset-link requests, matching passwords, fragment tokens, expired links, and session logout.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import PasswordReset from '../../frontend/src/pages/external/PasswordReset';

vi.mock('../../frontend/src/api/client', () => (// Replaces the imported dependency with controlled test doubles while retaining needed exports.

      // Handles this operation using the surrounding screen or request state.
      { api: { get: vi.fn(), post: vi.fn() } }));

// Renders the page under test with its required router/authentication context.
function renderPage(path, reset = false) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <PasswordReset reset={reset} />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  // Initializes clean test state, fixtures, mocks, or a local HTTP server before the test cases.

  localStorage.clear();
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(cleanup);

// Test case: Submits reset-link recovery and checks its API call and generic visible response.
it('requests a reset link and shows the generic response', async () => {

  api.post.mockResolvedValue({ message: 'If an external account matches that email, a password-reset link will be sent.' });
  renderPage('/external/forgot-password');

  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'alice@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

  expect(await screen.findByRole('status')).toBeTruthy();
  expect(screen.getByText(/If an account exists for this email/)).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'alice@example.com' });
});

// Test case: Tries mismatched then matching passwords and checks validation and token submission from the URL fragment.
it('requires matching passwords and submits the token from the URL fragment', async () => {

  api.post.mockResolvedValue({ message: 'Password updated. Please sign in again.' });
  localStorage.setItem('cs_token', 'existing-session');
  api.get.mockResolvedValue({ user: { id: 12, role: 'event_organiser' } });
  const token = 'a'.repeat(64);
  renderPage(`/external/reset-password#token=${token}`, true);

  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password123' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  expect(screen.getByRole('alert').textContent).toBe('Passwords must match.');
  expect(api.post).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'new-password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

  expect(await screen.findByRole('status')).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { token, password: 'new-password123' });
  expect(localStorage.getItem('cs_token')).toBeNull();
});

// Test case: Fails reset with an expired-token response and checks the visible API error.
it('shows the API error when a reset token has expired', async () => {

  api.post.mockRejectedValueOnce(new Error('This reset link is invalid or expired. Request a new link.'));
  const token = 'b'.repeat(64);
  renderPage(`/external/reset-password#token=${token}`, true);

  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password123' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'new-password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

  expect((await screen.findByRole('alert')).textContent).toMatch(/invalid or expired/);
  expect(screen.getByLabelText('New password')).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { token, password: 'new-password123' });
});

// Test case: Opens reset without a token and checks password submission is blocked.
it('blocks password submission when the reset token is missing', () => {

  renderPage('/external/reset-password', true);

  expect(screen.getByRole('heading', { name: 'Reset link invalid' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Update password' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Request new link' }).getAttribute('href')).toBe('/external/forgot-password');
});

// Test case: Submits recovery twice before the API resolves and checks one request; the resolved generic message is handled by the existing recovery test.
it('Password recovery AC1 - pending reset-link requests cannot submit twice',async()=>{
  let finish;api.post.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));renderPage('/external/forgot-password');
  fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'alice@example.test'}});const form=screen.getByRole('button',{name:'Send reset link'}).closest('form');
  fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledOnce();await act(async()=>finish({message:'Check email'}));
});
