import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('cs_token'));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me', token)
      .then((data) => setUser(data.user))
      .catch(() => {
        setToken(null);
        localStorage.removeItem('cs_token');
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function login(email, password) {
    const data = await api.post('/auth/login', { email, password });
    localStorage.setItem('cs_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  async function register(payload) {
    const data = await api.post('/auth/register', payload);
    localStorage.setItem('cs_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('cs_token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
