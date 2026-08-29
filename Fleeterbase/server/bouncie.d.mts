export interface BouncieConfig { clientId: string; clientSecret: string; redirectUri: string; webhookKey?: string }
export interface OAuthRequest { state: string; verifier: string; url: string; createdAt: string }
export interface TokenSet { accessToken: string; refreshToken: string; tokenType: string; expiresAt: string }
export interface BouncieVehicle { providerId: string; vin: string; imei: string; year: string; make: string; model: string; nickname: string }
export interface LocationPoint { id: string; providerKeys: string[]; latitude: number; longitude: number; speed: number; address: string; recordedAt: string; source: string; eventType: string }
export interface NormalizedWebhook { eventId: string; eventType: string; points: LocationPoint[] }
export function createOAuthRequest(config: BouncieConfig): OAuthRequest;
export function exchangeAuthorizationCode(config: BouncieConfig, request: { code: string; verifier: string }): Promise<TokenSet>;
export function refreshAccessToken(config: BouncieConfig, refreshToken: string): Promise<TokenSet>;
export function fetchVehicles(accessToken: string): Promise<BouncieVehicle[]>;
export function normalizeWebhook(payload: unknown, rawBody?: string): NormalizedWebhook;
