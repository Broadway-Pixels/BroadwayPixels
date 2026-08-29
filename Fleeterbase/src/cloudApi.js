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
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const cloudApi = {
  session: () => request('/api/auth/session'),
  register: (email, password, workspace) => request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, workspace }) }),
  resendVerification: email => request('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/auth/session', { method: 'DELETE' }),
  saveWorkspace: (workspace, version) => request('/api/workspace', { method: 'PUT', body: JSON.stringify({ workspace, version }) }),
  changePassword: (currentPassword, newPassword) => request('/api/account/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
  deleteAccount: currentPassword => request('/api/account', { method: 'DELETE', body: JSON.stringify({ currentPassword }) }),
};
