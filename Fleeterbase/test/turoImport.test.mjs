import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTuroCsv, parseCsv } from '../src/turoImport.js';

test('parses quoted CSV fields and CRLF rows', () => {
  assert.deepEqual(parseCsv('A,B\r\n"one, two",three\r\n'), [['A', 'B'], ['one, two', 'three']]);
});

test('maps common Turo earnings columns into reservations', () => {
  const result = mapTuroCsv('\uFEFFReservation ID,Guest Name,Vehicle,License Plate,Trip Start,Trip End,Host Earnings,Pickup Location\nTURO-44,Jamie Lee,2024 Toyota RAV4,ABC123,09/01/2026,09/04/2026,"$450.25",Orlando FL\n');
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.records[0], {
    turoTripId: 'TURO-44', guest: 'Jamie Lee', vehicleName: '2024 Toyota RAV4', plate: 'ABC123',
    start: '2026-09-01', end: '2026-09-04', price: 450.25, location: 'Orlando FL', status: 'Confirmed', source: 'Turo CSV',
  });
});

test('rejects files without required trip columns', () => {
  const result = mapTuroCsv('Guest,Amount\nJamie,120\n');
  assert.equal(result.records.length, 0);
  assert.match(result.errors[0], /tripId, vehicle, start, end/);
});
