import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the top-bar account control opens Profile instead of signing out', async () => {
  const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /className="account-button" onClick=\{onProfile\} title="Open profile"/);
  assert.doesNotMatch(source, /className="account-button" onClick=\{signOut\}/);
  assert.match(source, /aria-label="Sign out"/);
});
