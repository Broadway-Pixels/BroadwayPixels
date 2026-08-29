import type { OAuthRequest, TokenSet } from './bouncie.mjs';
export interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string }
export interface GmailCandidate { messageId: string; turoTripId: string; subject: string; from: string; guest: string; vehicleName: string; plate: string; location: string; start: string; end: string; price: number; status: string; source: string; receivedAt: string; ready: boolean; issues: string[] }
export interface GmailScan { query: string; resultSizeEstimate: number; candidates: GmailCandidate[] }
export function createGoogleOAuthRequest(config: GoogleConfig): OAuthRequest;
export function exchangeGoogleCode(config: GoogleConfig, request: { code: string; verifier: string }): Promise<TokenSet>;
export function refreshGoogleToken(config: GoogleConfig, refreshToken: string): Promise<TokenSet>;
export function fetchGmailProfile(accessToken: string): Promise<{ email: string; messagesTotal: number }>;
export function scanTuroMessages(accessToken: string, options: { afterEpoch: number; maxResults: number }): Promise<GmailScan>;
export function revokeGoogleToken(token: string): Promise<void>;
