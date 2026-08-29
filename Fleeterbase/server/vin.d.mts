export interface DecodedVehicle { vin: string; name: string; year: string; make: string; model: string; trim: string; bodyClass: string; fuelType: string; driveType: string }
export function normalizeVin(value: unknown): string;
export function vehicleFromVpic(payload: unknown): Omit<DecodedVehicle, 'vin'>;
export function decodeVin(vin: string, fetchImpl?: typeof fetch): Promise<DecodedVehicle>;
