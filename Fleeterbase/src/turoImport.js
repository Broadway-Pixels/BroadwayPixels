const aliases = {
  tripId: ['reservation id', 'trip id', 'booking id', 'trip number', 'reservation number'],
  guest: ['guest', 'guest name', 'primary guest', 'renter'],
  vehicle: ['vehicle', 'vehicle name', 'listing', 'car', 'listing name'],
  plate: ['license plate', 'plate', 'registration'],
  start: ['trip start', 'start', 'start date', 'pickup date', 'from'],
  end: ['trip end', 'end', 'end date', 'return date', 'to'],
  earnings: ['host earnings', 'earnings', 'amount earned', 'trip earnings', 'net earnings', 'amount'],
  location: ['pickup location', 'location', 'trip location'],
  status: ['trip status', 'status'],
};

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalized(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function columnIndex(headers, key) {
  const normalizedHeaders = headers.map(normalized);
  return normalizedHeaders.findIndex(header => aliases[key].includes(header));
}

function valueAt(row, indexes, key) {
  const index = indexes[key];
  return index >= 0 ? String(row[index] || '').trim() : '';
}

function isoDate(value) {
  if (!value) return '';
  const direct = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (direct) return `${direct[1]}-${direct[2].padStart(2, '0')}-${direct[3].padStart(2, '0')}`;
  const us = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function money(value) {
  const parsed = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapTuroCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { records: [], errors: ['The CSV has no trip rows.'], headers: rows[0] || [] };
  const headers = rows[0], indexes = {};
  Object.keys(aliases).forEach(key => { indexes[key] = columnIndex(headers, key); });
  const missing = ['tripId', 'vehicle', 'start', 'end'].filter(key => indexes[key] < 0);
  if (missing.length) return { records: [], errors: [`Missing required columns: ${missing.join(', ')}.`], headers };

  const errors = [], records = [];
  rows.slice(1).forEach((row, index) => {
    const record = {
      turoTripId: valueAt(row, indexes, 'tripId'),
      guest: valueAt(row, indexes, 'guest') || 'Turo guest',
      vehicleName: valueAt(row, indexes, 'vehicle'),
      plate: valueAt(row, indexes, 'plate'),
      start: isoDate(valueAt(row, indexes, 'start')),
      end: isoDate(valueAt(row, indexes, 'end')),
      price: money(valueAt(row, indexes, 'earnings')),
      location: valueAt(row, indexes, 'location'),
      status: valueAt(row, indexes, 'status') || 'Confirmed',
      source: 'Turo CSV',
    };
    const invalid = [];
    if (!record.turoTripId) invalid.push('trip ID');
    if (!record.vehicleName) invalid.push('vehicle');
    if (!record.start) invalid.push('start date');
    if (!record.end) invalid.push('end date');
    if (invalid.length) errors.push(`Row ${index + 2}: invalid ${invalid.join(', ')}.`);
    else records.push(record);
  });
  return { records, errors, headers };
}

export const TURO_TEMPLATE = 'Trip ID,Guest Name,Vehicle,License Plate,Trip Start,Trip End,Host Earnings,Pickup Location,Trip Status\n';
