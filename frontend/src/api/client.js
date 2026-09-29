const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(endpoint, { method = 'GET', body, token } = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error((data && data.message) || 'Something went wrong. Please try again.');
  }

  return data;
}

export const api = {
  get: (endpoint, token) => request(endpoint, { method: 'GET', token }),
  post: (endpoint, body, token) => request(endpoint, { method: 'POST', body, token })
};
