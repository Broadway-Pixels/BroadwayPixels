function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0'), day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function automateFleet(vehicles, reservations, now = new Date()) {
  const today = dateKey(now);
  const nextReservations = reservations.map(reservation => {
    if (reservation.status === 'Canceled') return reservation;
    const status = reservation.end < today ? 'Completed' : reservation.start <= today ? 'Active' : 'Confirmed';
    return status === reservation.status ? reservation : { ...reservation, status };
  });
  const activeVehicleIds = new Set(nextReservations.filter(item => item.status === 'Active').map(item => item.vehicleId));
  const nextVehicles = vehicles.map(vehicle => {
    if (vehicle.status === 'Service') return vehicle;
    const status = activeVehicleIds.has(vehicle.id) ? 'On trip' : 'Available';
    return status === vehicle.status ? vehicle : { ...vehicle, status };
  });
  return { vehicles: nextVehicles, reservations: nextReservations };
}

export function fleetAlerts(vehicles, reservations, now = new Date()) {
  const today = dateKey(now), alerts = [];
  for (const reservation of reservations) {
    if (reservation.status === 'Canceled') continue;
    if (reservation.start === today) alerts.push({ id: `pickup-${reservation.id}`, title: `Pickup today: ${reservation.guest}`, detail: 'Open Reservations to confirm the handoff.', target: 'Reservations' });
    if (reservation.end === today) alerts.push({ id: `return-${reservation.id}`, title: `Return today: ${reservation.guest}`, detail: 'Confirm the vehicle return and condition.', target: 'Reservations' });
  }
  for (const vehicle of vehicles) {
    if (vehicle.maintenance === 'Due' || vehicle.status === 'Service') alerts.push({ id: `service-${vehicle.id}`, title: `Service attention: ${vehicle.name}`, detail: 'Review the maintenance record before the next trip.', target: 'Maintenance' });
  }
  return alerts;
}
