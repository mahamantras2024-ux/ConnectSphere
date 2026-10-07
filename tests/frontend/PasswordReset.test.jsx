// File: Tests reset-link requests, matching passwords, fragment tokens, expired links, and session logout.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import App from '../../frontend/src/App';
import PasswordReset from '../../frontend/src/pages/external/PasswordReset';

vi.mock('../../frontend/src/api/client', () => (// Replaces the imported dependency with controlled test doubles while retaining needed exports.

      // Handles this operation using the surrounding screen or request state.
      { api: { get: vi.fn(), post: vi.fn() } }));

// Renders the page under test with its required router/authentication context.
function renderPage(path, reset = false, internal = false) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <PasswordReset reset={reset} internal={internal} />
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
it('Recovery UI AC1 - requests a reset link and shows the shortened confirmation', async () => {

  api.post.mockResolvedValue({ message: 'If an external account matches that email, a password-reset link will be sent.' });
  renderPage('/external/forgot-password');

  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'alice@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

  expect(await screen.findByRole('status')).toBeTruthy();
  expect(screen.getByText('A password reset link will be sent.')).toBeTruthy();
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

// Internal recovery AC1 AC2: staff use their own endpoint and return to staff sign-in.
it('Internal recovery AC1 AC2 - requests work-email link and returns to staff login',async()=>{
  api.post.mockResolvedValue({message:'Check email'});renderPage('/forgot-password',false,true);
  fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'staff@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:'Send reset link'}));
  await screen.findByRole('status');
  expect(api.post).toHaveBeenCalledWith('/auth/internal/forgot-password',{email:'staff@example.test'});
  expect(screen.getByRole('link',{name:'Back to sign in'}).getAttribute('href')).toBe('/login');
});
// Internal recovery AC3: staff passwords use fragment tokens and the internal consumption route.
it('Internal recovery AC3 - updates staff password through internal route',async()=>{
  api.post.mockResolvedValue({message:'Password updated'});renderPage('/reset-password#token='+ 'a'.repeat(64),true,true);
  fireEvent.change(screen.getByLabelText('New password'),{target:{value:'new-password123'}});
  fireEvent.change(screen.getByLabelText('Confirm password'),{target:{value:'new-password123'}});
  fireEvent.click(screen.getByRole('button',{name:'Update password'}));await screen.findByRole('status');
  expect(api.post).toHaveBeenCalledWith('/auth/internal/reset-password',{token:'a'.repeat(64),password:'new-password123'});
});
// Internal recovery AC3: missing staff tokens direct users to staff link recovery.
it('Internal recovery AC3 - missing token offers internal recovery',()=>{
  renderPage('/reset-password',true,true);
  expect(screen.getByRole('link',{name:'Request new link'}).getAttribute('href')).toBe('/forgot-password');
});

// Internal recovery AC1: exercise the actual staff login link and public route, not only a standalone page.
it('Internal recovery AC1 - staff login opens the recovery route',async()=>{
  render(<MemoryRouter initialEntries={['/login']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  expect(screen.queryByRole('link',{name:'Create an account'})).toBeNull();
  fireEvent.click(screen.getByRole('link',{name:'Forgot password?'}));
  expect(await screen.findByRole('heading',{name:'Forgot your password?'})).toBeTruthy();
  expect(screen.getByRole('link',{name:'Back to sign in'}).getAttribute('href')).toBe('/login');
});

// Email validation AC1: browser validation blocks malformed email submissions for both recovery audiences.
it.each([false,true])('Email validation AC1 - invalid email blocks reset-link submission when internal=%s',internal=>{
  renderPage(internal ? '/forgot-password' : '/external/forgot-password',false,internal);
  fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'not-an-email'}});
  const button=screen.getByRole('button',{name:'Send reset link'});
  expect(button.form.checkValidity()).toBe(false);fireEvent.click(button);
  expect(api.post).not.toHaveBeenCalled();
});

// Email validation AC2: unmatched account feedback preserves input and supports correction for either audience.
it.each([false,true])('Email validation AC2 - account-not-found permits retry when internal=%s',async internal=>{
  api.post.mockRejectedValueOnce(new Error('Account not found. Try again.')).mockResolvedValueOnce({message:'Check your inbox'});
  renderPage(internal ? '/forgot-password' : '/external/forgot-password',false,internal);
  fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'missing@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:'Send reset link'}));
  expect((await screen.findByRole('alert')).textContent).toBe('Account not found. Try again.');
  expect(screen.getByLabelText('Email address').value).toBe('missing@example.test');
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'recorded@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:'Send reset link'}));await screen.findByRole('status');
  expect(api.post).toHaveBeenLastCalledWith(internal?'/auth/internal/forgot-password':'/auth/forgot-password',{email:'recorded@example.test'});
});
