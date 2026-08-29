const cookieName = "bp_dashboard";
const encoder = new TextEncoder();

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(index % Math.max(b.length, 1)) || 0);
  }
  return mismatch === 0;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signature(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export function dashboardConfigured(env) {
  return String(env.DASHBOARD_USERNAME || "").length >= 3
    && String(env.DASHBOARD_PASSWORD || "").length >= 12
    && String(env.DASHBOARD_SESSION_SECRET || "").length >= 32;
}

export function verifyDashboardCredentials(input, env) {
  if (!dashboardConfigured(env)) return false;
  return safeEqual(input?.username, env.DASHBOARD_USERNAME) && safeEqual(input?.password, env.DASHBOARD_PASSWORD);
}

export async function createDashboardSession(env, now = Date.now()) {
  const expiresAt = now + 12 * 60 * 60 * 1000;
  const value = String(expiresAt);
  return `${value}.${await signature(value, env.DASHBOARD_SESSION_SECRET)}`;
}

export async function verifyDashboardSession(token, env, now = Date.now()) {
  if (!dashboardConfigured(env) || !token) return false;
  const [expiresAt, suppliedSignature, extra] = String(token).split(".");
  if (extra || !/^\d{13}$/.test(expiresAt) || Number(expiresAt) <= now) return false;
  return safeEqual(suppliedSignature, await signature(expiresAt, env.DASHBOARD_SESSION_SECRET));
}

export function readDashboardSession(cookieHeader = "") {
  const match = String(cookieHeader).split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return match ? decodeURIComponent(match.slice(cookieName.length + 1)) : "";
}

export function dashboardSessionCookie(token) {
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure`;
}

export function clearDashboardSessionCookie() {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`;
}
