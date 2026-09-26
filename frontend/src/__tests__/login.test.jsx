import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Login from '../pages/Login';

const login = vi.fn();
const navigate = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

function renderLogin(props = {}) {
  return render(
    <MemoryRouter>
      <Login {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  login.mockReset();
  navigate.mockReset();
});

describe('Login', () => {
  it.each([
    ['event_organiser', '/organizer/dashboard'],
    ['event_coordinator', '/coordinator/dashboard'],
    ['attendee', '/attendee/dashboard'],
    ['venue_staff', '/venue/dashboard'],
    ['technical_support', '/tech-support/dashboard'],
  ])('submits credentials and routes %s to the correct dashboard', async (role, route) => {
    login.mockResolvedValue({ role });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('staff@example.com', 'secret123', undefined));
    expect(navigate).toHaveBeenCalledWith(route, { replace: true });
  });

  it('shows a loading state and disables submission while login is pending', async () => {
    let resolveLogin;
    login.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(screen.getByRole('button', { name: 'Signing in...' }).disabled).toBe(true);
    resolveLogin({ role: 'attendee' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/attendee/dashboard', { replace: true }));
  });

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

  it('uses the fallback message when the login error has no message', async () => {
    login.mockRejectedValue({});
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password. Please try again.');
  });

  it('renders external sign-in content and sends the external audience', async () => {
    login.mockResolvedValue({ role: 'event_organiser' });
    renderLogin({ external: true });

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/external/register');
    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/external/forgot-password');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'organiser@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('organiser@example.com', 'secret123', 'external'));
  });

  it('requires both email and password before submission', () => {
    renderLogin();

    const form = screen.getByRole('button', { name: 'Login' }).form;
    expect(form.checkValidity()).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });
});