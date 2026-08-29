async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const bouncieApi = {
  session: () => request('/api/session'),
  signIn: (email, password) => request('/api/session', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signOut: () => request('/api/session', { method: 'DELETE' }),
  status: () => request('/api/bouncie/status'),
  vehicles: () => request('/api/bouncie/vehicles'),
  locations: since => request(`/api/bouncie/locations?limit=1000${since ? `&since=${encodeURIComponent(since)}` : ''}`),
  saveMappings: mappings => request('/api/bouncie/mappings', { method: 'PUT', body: JSON.stringify({ mappings }) }),
  disconnect: () => request('/api/bouncie/connection', { method: 'DELETE' }),
};

export const gmailApi = {
  session: () => request('/api/session'),
  status: () => request('/api/gmail/status'),
  scan: months => request('/api/gmail/scan', { method: 'POST', body: JSON.stringify({ months }) }),
  disconnect: () => request('/api/gmail/connection', { method: 'DELETE' }),
};
