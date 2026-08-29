const text = value => String(value ?? '').trim();

export function normalizeVin(value) {
  return text(value).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);
}

export function vehicleFromVpic(payload) {
  const decoded = Array.isArray(payload?.Results) ? payload.Results[0] : null;
  if (!decoded) throw new Error('The VIN decoder returned no vehicle information.');
  const errorCode = text(decoded.ErrorCode);
  if (errorCode && errorCode !== '0') throw new Error(text(decoded.ErrorText) || 'This VIN could not be decoded.');
  const year = text(decoded.ModelYear), make = text(decoded.Make), model = text(decoded.Model);
  if (!year && !make && !model) throw new Error('No year, make, or model was found for this VIN.');
  return {
    name: [year, make, model].filter(Boolean).join(' '),
    year,
    make,
    model,
    trim: text(decoded.Trim),
    bodyClass: text(decoded.BodyClass),
    fuelType: text(decoded.FuelTypePrimary),
    driveType: text(decoded.DriveType),
  };
}

export async function decodeVin(vin, fetchImpl = fetch) {
  const normalized = normalizeVin(vin);
  if (normalized.length !== 17) throw new Error('Enter a complete 17-character VIN.');
  const response = await fetchImpl(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(normalized)}?format=json`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('The NHTSA VIN decoder is temporarily unavailable.');
  return { vin: normalized, ...vehicleFromVpic(await response.json()) };
}
