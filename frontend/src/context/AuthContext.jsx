// File: Shares identity/session state, restores stored tokens, and handles login/logout with stale-response guards.
// App-wide state shared without prop-drilling through every component.
// AuthContext holds the logged-in user and token, read by Navbar, ProtectedRoute, and every page.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

// Provides session state, restores stored tokens, and exposes login/logout to child components.
export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => // Reads the stored authentication token once when initializing session state.

      // Handles this operation using the surrounding screen or request state.
      localStorage.getItem('cs_token'));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const sessionVersion = useRef(0);

  useEffect(() => {
    // Restores the stored session and ignores responses after token changes or cleanup.

    let active = true;
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    api
      .get('/auth/me', token)
      .then((data) => {
        // Restores the returned user only while the current session request remains active.
         if (active) setUser(data.user); })
      .catch(() => {
        // Clears a rejected session while ignoring stale authentication requests.

        if (!active) return;
        setUser(null);
        setToken(null);
        localStorage.removeItem('cs_token');
      })
      .finally(() => {
        // Clears loading state when the current request settles.
         if (active) setLoading(false); });
    return () => {
      // Marks this request inactive so late responses cannot update an unmounted or changed screen.
       active = false; };
  }, [token]);

  // Signs in through the API, persists the JWT, and updates shared user/session state.
  async function login(email, password, audience) {
    const version = ++sessionVersion.current;
    const data = await api.post('/auth/login', { email, password, ...(audience ? { audience } : {}) });
    if (version !== sessionVersion.current) throw new Error('This sign-in request is no longer active.');

    localStorage.setItem('cs_token', data.token);
    setToken(data.token);
    setUser(data.user);

    return data.user;
  }

  // Removes the stored token and clears the current user/session state.
  function logout() {
    sessionVersion.current += 1;
    localStorage.removeItem('cs_token');
    setToken(null);
    setUser(null);
  }

  // Requests a database-validated role and replaces the active role's session token.
  async function switchRole(role) {
    const version = ++sessionVersion.current;
    const data = await api.post('/auth/switch-role', { role }, token);
    if (version !== sessionVersion.current) throw new Error('This role-switch request is no longer active.');
    localStorage.setItem('cs_token', data.token); setToken(data.token); setUser(data.user);
    return data.user;
  }
  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

// Reads authentication context and rejects use outside the authentication provider.
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
