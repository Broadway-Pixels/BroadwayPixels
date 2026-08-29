import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFile, chmod, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function encryptionKey(value) {
  const input = String(value || '').trim();
  const buffer = /^[a-f0-9]{64}$/i.test(input) ? Buffer.from(input, 'hex') : Buffer.from(input, 'base64');
  if (buffer.length !== 32) throw new Error('FLEETERBASE_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex characters.');
  return buffer;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export class FleeterbaseStore {
  constructor(directory, key) {
    this.directory = directory;
    this.key = encryptionKey(key);
    this.queue = Promise.resolve();
  }

  file(name) { return path.join(this.directory, name); }

  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
  }

  locked(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async writeJson(name, value) {
    const target = this.file(name), temporary = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
    await chmod(target, 0o600);
  }

  encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
  }

  decrypt(envelope) {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
  }

  async saveTokens(tokens) { return this.locked(() => this.writeJson('bouncie-tokens.enc.json', this.encrypt(tokens))); }
  async getTokens() { const stored = await readJson(this.file('bouncie-tokens.enc.json'), null); return stored ? this.decrypt(stored) : null; }
  async clearTokens() { return this.locked(() => this.writeJson('bouncie-tokens.enc.json', null)); }
  async savePendingOAuth(pending) { return this.locked(() => this.writeJson('oauth-pending.enc.json', this.encrypt(pending))); }
  async getPendingOAuth() { const stored = await readJson(this.file('oauth-pending.enc.json'), null); return stored ? this.decrypt(stored) : null; }
  async clearPendingOAuth() { return this.locked(() => this.writeJson('oauth-pending.enc.json', null)); }

  async saveGmailTokens(tokens) { return this.locked(() => this.writeJson('gmail-tokens.enc.json', this.encrypt(tokens))); }
  async getGmailTokens() { const stored = await readJson(this.file('gmail-tokens.enc.json'), null); return stored ? this.decrypt(stored) : null; }
  async clearGmailTokens() { return this.locked(() => this.writeJson('gmail-tokens.enc.json', null)); }
  async savePendingGoogleOAuth(pending) { return this.locked(() => this.writeJson('google-oauth-pending.enc.json', this.encrypt(pending))); }
  async getPendingGoogleOAuth() { const stored = await readJson(this.file('google-oauth-pending.enc.json'), null); return stored ? this.decrypt(stored) : null; }
  async clearPendingGoogleOAuth() { return this.locked(() => this.writeJson('google-oauth-pending.enc.json', null)); }
  async saveGmailStatus(status) { return this.locked(() => this.writeJson('gmail-status.json', status)); }
  async getGmailStatus() { return readJson(this.file('gmail-status.json'), {}); }

  async getMappings() { return readJson(this.file('bouncie-mappings.json'), []); }
  async saveMappings(mappings) { return this.locked(() => this.writeJson('bouncie-mappings.json', mappings)); }

  async recordWebhook(normalized) {
    return this.locked(async () => {
      const receipts = await readJson(this.file('webhook-receipts.json'), []);
      if (receipts.includes(normalized.eventId)) return { duplicate: true, storedPoints: 0 };
      if (normalized.points.length) {
        await appendFile(this.file('locations.ndjson'), normalized.points.map(point => JSON.stringify(point)).join('\n') + '\n', { mode: 0o600 });
        await chmod(this.file('locations.ndjson'), 0o600);
      }
      const nextReceipts = [...receipts, normalized.eventId].slice(-5000);
      await this.writeJson('webhook-receipts.json', nextReceipts);
      await this.writeJson('bouncie-status.json', { lastEventAt: new Date().toISOString(), lastEventType: normalized.eventType });
      return { duplicate: false, storedPoints: normalized.points.length };
    });
  }

  async status() { return readJson(this.file('bouncie-status.json'), {}); }

  async listLocations({ since = '', limit = 1000 } = {}) {
    let contents = '';
    try {
      const handle = await open(this.file('locations.ndjson'), 'r');
      try {
        const details = await handle.stat(), length = Math.min(details.size, 4 * 1024 * 1024), start = details.size - length, buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        contents = buffer.toString('utf8');
        if (start > 0) contents = contents.slice(contents.indexOf('\n') + 1);
      } finally { await handle.close(); }
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const mappings = await this.getMappings(), byKey = new Map();
    mappings.forEach(mapping => mapping.providerKeys.forEach(key => byKey.set(key, mapping.vehicleId)));
    const sinceTime = since ? new Date(since).getTime() : 0;
    return contents.split('\n').filter(Boolean).map(line => JSON.parse(line)).map(point => ({
      ...point,
      vehicleId: point.providerKeys.map(key => byKey.get(key)).find(Boolean) || null,
    })).filter(point => point.vehicleId && new Date(point.recordedAt).getTime() > sinceTime).slice(-Math.min(Math.max(Number(limit) || 1000, 1), 5000));
  }
}
