// File: Tests the shared login form, role destinations, pending/error states, and external audience.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
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

  // Test case: Submits valid credentials for each role and checks navigation to its dashboard route.
  it.each([
    ['event_organiser', '/organizer/dashboard'],
    ['event_coordinator', '/coordinator/dashboard'],
    ['attendee', '/attendee/dashboard'],
    ['venue_staff', '/venue/dashboard'],
    ['technical_support', '/tech-support/dashboard'],
    ['event_coordinator_lead', '/coordinator-lead/dashboard'],
    ['safety_officer', '/safety/dashboard'],
  ])('submits credentials and routes %s to the correct dashboard', async (role, route) => {

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

  // Test case: Leaves login pending and checks loading feedback and disabled submission.
  it('shows a loading state and disables submission while login is pending', async () => {

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

  // Test case: Fails login with an error message and checks it is displayed and the form becomes usable.
  it('displays the login error and re-enables the form when login fails', async () => {

    login.mockRejectedValue(new Error('Account is locked.'));
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Account is locked.');
    expect(screen.getByRole('button', { name: 'Login' }).disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  // Test case: Fails login without a message and checks the readable fallback.
  it('uses the fallback message when the login error has no message', async () => {

    login.mockRejectedValue({});
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password. Please try again.');
  });

  // Test case: Opens external sign-in and checks content and external-audience payload.
  it('renders external sign-in content and sends the external audience', async () => {

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

  // Test case: Omits email/password and checks incomplete credentials cannot submit.
  it('requires both email and password before submission', () => {

    renderLogin();

    const form = screen.getByRole('button', { name: 'Login' }).form;
    expect(form.checkValidity()).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });
});
