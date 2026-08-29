import { createHash, randomBytes } from 'node:crypto';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const base64Url = value => Buffer.from(value).toString('base64url');
const text = value => String(value ?? '').trim();

export function createGoogleOAuthRequest(config) {
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(48));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GMAIL_READONLY_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { state, verifier, url: url.toString(), createdAt: new Date().toISOString() };
}

async function responseJson(response) {
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { payload = { error: raw || 'Invalid Google response' }; }
  if (!response.ok) {
    const detail = payload.error_description || payload.error?.message || payload.error || `Google request failed (${response.status})`;
    const error = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    error.status = response.status;
    throw error;
  }
  return payload;
}

function normalizeTokens(payload, previousRefreshToken = '') {
  if (!payload.access_token) throw new Error('Google did not return an access token.');
  const refreshToken = payload.refresh_token || previousRefreshToken;
  if (!refreshToken) throw new Error('Google did not return offline access. Reconnect Gmail and approve access again.');
  return {
    accessToken: payload.access_token,
    refreshToken,
    scope: payload.scope || GMAIL_READONLY_SCOPE,
    tokenType: payload.token_type || 'Bearer',
    expiresAt: new Date(Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000).toISOString(),
  };
}

export async function exchangeGoogleCode(config, { code, verifier }, fetchImpl = fetch) {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: config.redirectUri }),
  });
  return normalizeTokens(await responseJson(response));
}

export async function refreshGoogleToken(config, refreshToken, fetchImpl = fetch) {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  return normalizeTokens(await responseJson(response), refreshToken);
}

async function gmailRequest(path, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(`${GMAIL_API_BASE}${path}`, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  return responseJson(response);
}

export async function fetchGmailProfile(accessToken, fetchImpl = fetch) {
  const profile = await gmailRequest('/profile', accessToken, fetchImpl);
  return { email: text(profile.emailAddress), messagesTotal: Number(profile.messagesTotal || 0) };
}

function decode(value) {
  if (!value) return '';
  try { return Buffer.from(value, 'base64url').toString('utf8'); }
  catch { return ''; }
}

function htmlToText(value) {
  return value.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;/g, "'").replace(/&quot;/gi, '"');
}

function messageBody(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain') return decode(part.body?.data);
  if (part.mimeType === 'text/html') return htmlToText(decode(part.body?.data));
  const children = Array.isArray(part.parts) ? part.parts : [];
  const plain = children.filter(child => child.mimeType === 'text/plain').map(messageBody).filter(Boolean);
  return plain.length ? plain.join('\n') : children.map(messageBody).filter(Boolean).join('\n');
}

function header(message, name) {
  return text(message.payload?.headers?.find(item => String(item.name).toLowerCase() === name.toLowerCase())?.value);
}

function cleanLines(value) {
  return value.replace(/\r/g, '').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function labeledValue(lines, labels) {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(new RegExp(`^${label}\\s*[:#-]\\s*(.+)$`, 'i'));
      if (match) return text(match[1]);
    }
  }
  return '';
}

function dateValue(value) {
  const iso = text(value).match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const month = String(Number(iso[2])).padStart(2, '0'), day = String(Number(iso[3])).padStart(2, '0');
    const candidate = `${iso[1]}-${month}-${day}`, parsed = new Date(`${candidate}T12:00:00`);
    if (parsed.getFullYear() === Number(iso[1]) && parsed.getMonth() + 1 === Number(month) && parsed.getDate() === Number(day)) return candidate;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear(), month = String(date.getMonth() + 1).padStart(2, '0'), day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findDate(lines, labels) {
  const labeled = labeledValue(lines, labels);
  if (labeled) return dateValue(labeled.replace(/\bat\b.*$/i, '').trim());
  return '';
}

function findFallbackDates(value) {
  const patterns = [
    /\b20\d{2}-\d{1,2}-\d{1,2}\b/g,
    /\b\d{1,2}\/\d{1,2}\/20\d{2}\b/g,
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/gi,
  ];
  return [...new Set(patterns.flatMap(pattern => value.match(pattern) || []).map(dateValue).filter(Boolean))];
}

export function parseTuroMessage(message) {
  const subject = header(message, 'subject'), from = header(message, 'from');
  const body = messageBody(message.payload), lines = cleanLines(body), combined = `${subject}\n${body}`;
  const tripMatch = combined.match(/(?:trip|reservation|booking)\s*(?:id|number|#)?\s*[:#-]?\s*([A-Z0-9-]{5,})/i);
  const tripCandidate = tripMatch?.[1] && /\d/.test(tripMatch[1]) ? tripMatch[1] : '';
  const subjectBooking = subject.match(/^(.+?)\s+(?:booked|reserved)\s+your\s+(.+?)(?:\s+for\s+|$)/i);
  const guest = labeledValue(lines, ['guest', 'guest name', 'booked by', 'renter']) || text(subjectBooking?.[1]);
  const vehicleName = labeledValue(lines, ['vehicle', 'car', 'vehicle booked']) || text(subjectBooking?.[2]);
  let start = findDate(lines, ['trip start', 'start', 'pickup', 'pick-up', 'check-in']);
  let end = findDate(lines, ['trip end', 'end', 'return', 'drop-off', 'checkout']);
  if (!start || !end) {
    const dates = findFallbackDates(combined);
    start ||= dates[0] || '';
    end ||= dates[1] || '';
  }
  const money = labeledValue(lines, ['host earnings', 'earnings', 'payout', 'trip earnings']);
  const priceMatch = money.match(/\$?([\d,]+(?:\.\d{1,2})?)/) || combined.match(/(?:host earnings|earnings|payout)\D{0,20}\$([\d,]+(?:\.\d{1,2})?)/i);
  const price = Number(String(priceMatch?.[1] || '0').replace(/,/g, ''));
  const issues = [];
  if (!guest) issues.push('guest name');
  if (!vehicleName) issues.push('vehicle');
  if (!start) issues.push('pickup date');
  if (!end) issues.push('return date');
  return {
    messageId: text(message.id),
    turoTripId: tripCandidate || `gmail-${text(message.id)}`,
    subject,
    from,
    guest,
    vehicleName,
    plate: '',
    location: '',
    start,
    end,
    price: Number.isFinite(price) ? price : 0,
    status: /cancel/i.test(subject) ? 'Canceled' : 'Confirmed',
    source: 'Turo Gmail',
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : '',
    ready: issues.length === 0,
    issues,
  };
}

export async function scanTuroMessages(accessToken, { afterEpoch, maxResults = 50 } = {}, fetchImpl = fetch) {
  const query = `from:(turo.com) after:${Math.floor(afterEpoch || Date.now() / 1000 - 180 * 86400)}`;
  const list = await gmailRequest(`/messages?maxResults=${Math.min(Math.max(maxResults, 1), 100)}&q=${encodeURIComponent(query)}`, accessToken, fetchImpl);
  const ids = (list.messages || []).map(message => message.id).filter(Boolean);
  const messages = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = await Promise.all(ids.slice(index, index + 10).map(id => gmailRequest(`/messages/${encodeURIComponent(id)}?format=full`, accessToken, fetchImpl)));
    messages.push(...batch);
  }
  return { query, resultSizeEstimate: Number(list.resultSizeEstimate || ids.length), candidates: messages.map(parseTuroMessage) };
}

export async function revokeGoogleToken(token, fetchImpl = fetch) {
  if (!token) return;
  const response = await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  if (!response.ok && response.status !== 400) throw new Error(`Google token revocation failed (${response.status}).`);
}
