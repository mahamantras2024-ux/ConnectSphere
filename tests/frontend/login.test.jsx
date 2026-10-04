// File: Tests the shared login form, role destinations, pending/error states, and external audience.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Login from '../../frontend/src/pages/Login';

const login = vi.fn();
const navigate = vi.fn();

vi.mock('../../frontend/src/context/AuthContext', () => (// Replaces the imported dependency with controlled test doubles while retaining needed exports.

      // Handles this operation using the surrounding screen or request state.
      {
  useAuth: () => (// Reads authentication context and rejects use outside the authentication provider.

      // Handles this operation using the surrounding screen or request state.
      { login }),
}));

vi.mock('react-router-dom', async () => {
  // Replaces the imported dependency with controlled test doubles while retaining needed exports.

  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => // Provides the controlled return value or asynchronous action needed by this test.

      // Handles this operation using the surrounding screen or request state.
      navigate,
  };
});

// Renders the login form under a test router using the supplied props.
function renderLogin(props = {}) {
  return render(
    <MemoryRouter>
      <Login {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  // Cleans up test state, mocks, mounted components, or local server/database resources.

  cleanup();
  login.mockReset();
  navigate.mockReset();
});

describe('Login', () => {
  // Groups regression cases for: Login.

  it.each([
    ['event_organiser', '/organizer/dashboard'],
    ['event_coordinator', '/coordinator/dashboard'],
    ['attendee', '/attendee/dashboard'],
    ['venue_staff', '/venue/dashboard'],
    ['technical_support', '/tech-support/dashboard'],
    ['event_coordinator_lead', '/coordinator-lead/dashboard'],
    ['safety_officer', '/safety/dashboard'],
  ])('submits credentials and routes %s to the correct dashboard', async (role, route) => {
    // Verifies: submits credentials and routes %s to the correct dashboard.

    login.mockResolvedValue({ role });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(login).toHaveBeenCalledWith('staff@example.com', 'secret123', 'internal'));
    expect(navigate).toHaveBeenCalledWith(route, { replace: true });
  });

  it('shows a loading state and disables submission while login is pending', async () => {
    // Verifies: shows a loading state and disables submission while login is pending.

    let resolveLogin;
    login.mockReturnValue(new Promise((resolve) => {
      // Captures the promise resolver so a test can control when the pending operation completes.
       resolveLogin = resolve; }));
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(screen.getByRole('button', { name: 'Signing in...' }).disabled).toBe(true);
    resolveLogin({ role: 'attendee' });
    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(navigate).toHaveBeenCalledWith('/attendee/dashboard', { replace: true }));
  });

  it('displays the login error and re-enables the form when login fails', async () => {
    // Verifies: displays the login error and re-enables the form when login fails.

    login.mockRejectedValue(new Error('Account is locked.'));
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Account is locked.');
    expect(screen.getByRole('button', { name: 'Login' }).disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('uses the fallback message when the login error has no message', async () => {
    // Verifies: uses the fallback message when the login error has no message.

    login.mockRejectedValue({});
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password. Please try again.');
  });

  it('renders external sign-in content and sends the external audience', async () => {
    // Verifies: renders external sign-in content and sends the external audience.

    login.mockResolvedValue({ role: 'event_organiser' });
    renderLogin({ external: true });

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/external/register');
    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/external/forgot-password');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'organiser@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(login).toHaveBeenCalledWith('organiser@example.com', 'secret123', 'external'));
  });

  it('requires both email and password before submission', () => {
    // Verifies: requires both email and password before submission.

    renderLogin();

    const form = screen.getByRole('button', { name: 'Login' }).form;
    expect(form.checkValidity()).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });
});
