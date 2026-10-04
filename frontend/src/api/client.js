// File: Sends JSON requests to the Express API, attaches optional bearer tokens, and converts failed responses into errors.
// api is one shared helper for talking to the backend.

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Sends a JSON API request with optional JWT and decodes the response or throws its error message.
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
    const error = new Error((data && data.message) || 'Something went wrong. Please try again.');
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

export const api = {
  get: (endpoint, token) => // Delegates an API GET request to the shared request helper.

      // Handles this operation using the surrounding screen or request state.
      request(endpoint, { method: 'GET', token }),
  post: (endpoint, body, token) => // Delegates an API POST request to the shared request helper.

      // Handles this operation using the surrounding screen or request state.
      request(endpoint, { method: 'POST', body, token }),
  // Saves an existing record through the shared authenticated request helper.
  put: (endpoint, body, token) => request(endpoint, { method: 'PUT', body, token }),
  // Requests non-destructive venue removal through the shared authenticated request helper.
  delete: (endpoint, token) => request(endpoint, { method: 'DELETE', token })
};
