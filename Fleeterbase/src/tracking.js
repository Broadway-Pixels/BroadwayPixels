export function coordinateIsValid(latitude, longitude) {
  const lat = Number(latitude), lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function latestByVehicle(points) {
  const latest = new Map();
  points.forEach(point => {
    const current = latest.get(point.vehicleId);
    if (!current || new Date(point.recordedAt) > new Date(current.recordedAt)) latest.set(point.vehicleId, point);
  });
  return latest;
}

export function createTrackingPoint(form, id, recordedAt = new Date().toISOString()) {
  if (!form.vehicleId) throw new Error('Choose a vehicle.');
  if (!coordinateIsValid(form.latitude, form.longitude)) throw new Error('Enter valid latitude and longitude coordinates.');
  const speed = Number(form.speed || 0);
  if (!Number.isFinite(speed) || speed < 0) throw new Error('Speed cannot be negative.');
  return {
    id,
    vehicleId: form.vehicleId,
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    address: String(form.address || '').trim(),
    speed,
    source: 'Manual check-in',
    recordedAt,
  };
}

export function navigationLinks(point) {
  if (!point) return { google: '', apple: '' };
  const destination = `${point.latitude},${point.longitude}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
    apple: `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`,
  };
}
