import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeVin, normalizeVin, vehicleFromVpic } from '../server/vin.mjs';

test('normalizes VIN input and excludes invalid VIN letters', () => {
  assert.equal(normalizeVin(' 1hgcm82633a004352 '), '1HGCM82633A004352');
  assert.equal(normalizeVin('IOQ-123'), '123');
});

test('maps NHTSA flat VIN data into Fleeterbase vehicle fields', () => {
  assert.deepEqual(vehicleFromVpic({ Results: [{ ErrorCode: '0', ModelYear: '2003', Make: 'HONDA', Model: 'Accord', Trim: 'EX-V6', BodyClass: 'Coupe', FuelTypePrimary: 'Gasoline', DriveType: 'FWD/Front-Wheel Drive' }] }), {
    name: '2003 HONDA Accord', year: '2003', make: 'HONDA', model: 'Accord', trim: 'EX-V6', bodyClass: 'Coupe', fuelType: 'Gasoline', driveType: 'FWD/Front-Wheel Drive',
  });
});

test('decodes a complete VIN through the NHTSA flat-format endpoint', async () => {
  const fetchImpl = async url => {
    assert.match(url, /DecodeVinValues\/1HGCM82633A004352\?format=json$/);
    return new Response(JSON.stringify({ Results: [{ ErrorCode: '0', ModelYear: '2003', Make: 'HONDA', Model: 'Accord' }] }));
  };
  assert.equal((await decodeVin('1hgcm82633a004352', fetchImpl)).name, '2003 HONDA Accord');
  await assert.rejects(() => decodeVin('short', fetchImpl), /17-character VIN/);
});
