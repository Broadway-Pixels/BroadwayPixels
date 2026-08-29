async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Billing request failed (${response.status})`);
  return payload;
}

export const billingApi = {
  status: () => request('/api/billing/status'),
  checkout: () => request('/api/billing/checkout', { method: 'POST' }),
  portal: () => request('/api/billing/portal', { method: 'POST' }),
};
