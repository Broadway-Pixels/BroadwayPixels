import {
  clearDashboardSessionCookie,
  createDashboardSession,
  dashboardConfigured,
  dashboardSessionCookie,
  readDashboardSession,
  verifyDashboardCredentials,
  verifyDashboardSession,
} from "./auth.mjs";
import { isAllowedOrigin, sendSupportEmails, sendTicketReply, validateSupportSubmission, validateTicketReply } from "../lib/support.mjs";
import { D1Store, validatePageView } from "./store.mjs";

const ticketIdPattern = /^B\d{10}$/;
const apiHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...apiHeaders, ...headers },
  });
}

function requestHeaders(request) {
  const url = new URL(request.url);
  return { origin: request.headers.get("Origin") || "", host: url.host };
}

function allowed(request, env, requireOrigin = false) {
  const headers = requestHeaders(request);
  if (requireOrigin && !headers.origin) return false;
  return isAllowedOrigin(headers, env.ALLOWED_ORIGINS || "");
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 20_000) throw new Error("Request too large");
  const body = await request.text();
  if (body.length > 20_000) throw new Error("Request too large");
  return JSON.parse(body || "{}");
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
}

async function createTicketId(requestId) {
  const bytes = await digest(requestId);
  const value = new DataView(bytes.buffer).getBigUint64(0) % 10_000_000_000n;
  return `B${value.toString().padStart(10, "0")}`;
}

async function rateLimited(store, request, scope, maxAttempts, windowMs) {
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const hash = [...await digest(address)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return store.rateLimited(`${scope}:${hash}`, maxAttempts, windowMs);
}

async function dashboardAuthorized(request, env) {
  const token = readDashboardSession(request.headers.get("Cookie") || "");
  return verifyDashboardSession(token, env);
}

async function handleSupport(request, env, store) {
  if (request.method !== "POST") return json(405, { message: "Method not allowed." });
  if (!String(request.headers.get("Content-Type") || "").startsWith("application/json")) return json(415, { message: "Content type must be application/json." });
  if (!allowed(request, env)) return json(403, { message: "Request origin is not allowed." });
  if (await rateLimited(store, request, "support", 5, 10 * 60 * 1000)) return json(429, { message: "Too many requests. Try again in a few minutes." });
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json(400, { message: "Request body must be valid JSON." });
  }
  const validation = validateSupportSubmission(body);
  if (!validation.ok) return json(validation.silent ? 200 : 422, { message: validation.message });
  const ticketId = await createTicketId(validation.submission.requestId);
  const result = await sendSupportEmails(validation.submission, ticketId, env);
  if (!result.ok) return json(result.status, { message: result.message });
  try {
    await store.recordTicket({
      ticketId,
      name: validation.submission.name,
      email: validation.submission.email,
      project: validation.submission.project,
      topic: validation.submission.topic,
      message: validation.submission.message,
      link: validation.submission.link,
      confirmationSent: result.confirmationSent,
      notificationEmailId: result.id,
      confirmationEmailId: result.confirmationId || "",
    });
  } catch (error) {
    console.error("Support ticket recording failed", error);
    return json(500, { message: "Your email was sent, but the ticket could not be recorded. Please submit again." });
  }
  return json(200, { message: "Support request sent.", ticketId, confirmationSent: result.confirmationSent });
}

async function handleAnalytics(request, env, store) {
  if (request.method !== "POST") return json(405, { message: "Method not allowed." });
  if (!String(request.headers.get("Content-Type") || "").startsWith("application/json")) return json(415, { message: "Content type must be application/json." });
  if (!allowed(request, env)) return json(403, { message: "Request origin is not allowed." });
  if (await rateLimited(store, request, "analytics", 200, 10 * 60 * 1000)) return json(429, { message: "Too many requests." });
  let validation;
  try {
    validation = validatePageView(await readJson(request));
  } catch {
    return json(400, { message: "Request body must be valid JSON." });
  }
  if (!validation.ok) return json(422, { message: validation.message });
  try {
    await store.recordPageView(validation.event);
    return json(202, { recorded: true });
  } catch (error) {
    console.error("Analytics recording failed", error);
    return json(500, { message: "Analytics are temporarily unavailable." });
  }
}

async function handleDashboardLogin(request, env, store) {
  if (request.method !== "POST") return json(405, { message: "Method not allowed." });
  if (!String(request.headers.get("Content-Type") || "").startsWith("application/json")) return json(415, { message: "Content type must be application/json." });
  if (!allowed(request, env)) return json(403, { message: "Request origin is not allowed." });
  if (!dashboardConfigured(env)) return json(503, { message: "Dashboard access is not configured." });
  if (await rateLimited(store, request, "login", 10, 15 * 60 * 1000)) return json(429, { message: "Too many sign-in attempts. Try again later." });
  try {
    const credentials = await readJson(request);
    if (!verifyDashboardCredentials(credentials, env)) return json(401, { message: "Username or password is incorrect." });
    return json(200, { authenticated: true }, { "Set-Cookie": dashboardSessionCookie(await createDashboardSession(env)) });
  } catch {
    return json(400, { message: "Request body must be valid JSON." });
  }
}

async function handleDashboardStats(request, env, store, url) {
  if (request.method !== "GET") return json(405, { message: "Method not allowed." });
  if (!await dashboardAuthorized(request, env)) return json(401, { message: "Sign in to view website stats." });
  try {
    return json(200, await store.stats(Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30))));
  } catch (error) {
    console.error("Dashboard stats failed", error);
    return json(500, { message: "Stats are temporarily unavailable." });
  }
}

async function handleDashboardTickets(request, env, store, url) {
  if (request.method !== "GET") return json(405, { message: "Method not allowed." });
  if (!await dashboardAuthorized(request, env)) return json(401, { message: "Sign in to view support tickets." });
  try {
    const tickets = await store.listTickets(Math.min(250, Math.max(1, Number(url.searchParams.get("limit")) || 100)));
    return json(200, { tickets, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Dashboard tickets failed", error);
    return json(500, { message: "Support tickets are temporarily unavailable." });
  }
}

async function handleTicketAction(request, env, store, ticketId, action) {
  if (!ticketIdPattern.test(ticketId)) return json(404, { message: "Ticket not found." });
  if (!await dashboardAuthorized(request, env)) return json(401, { message: "Sign in to manage support tickets." });
  if (!allowed(request, env, true)) return json(403, { message: "Request origin is not allowed." });
  if (await rateLimited(store, request, "dashboard-action", 40, 10 * 60 * 1000)) return json(429, { message: "Too many dashboard actions. Try again in a few minutes." });
  try {
    const ticket = await store.getTicket(ticketId);
    if (!ticket) return json(404, { message: "Ticket not found." });
    if (action === "delete") {
      if (request.method !== "DELETE") return json(405, { message: "Method not allowed." });
      await store.removeTicket(ticketId);
      return json(200, { deleted: true, ticketId });
    }
    if (request.method !== "POST") return json(405, { message: "Method not allowed." });
    if (action === "archive" || action === "unarchive") {
      await store.archiveTicket(ticketId, action === "archive");
      return json(200, { ticketId, status: action === "archive" ? "archived" : "open" });
    }
    if (action === "reply") {
      if (!String(request.headers.get("Content-Type") || "").startsWith("application/json")) return json(415, { message: "Content type must be application/json." });
      let body;
      try {
        body = await readJson(request);
      } catch {
        return json(400, { message: "Request body must be valid JSON." });
      }
      const validation = validateTicketReply(body);
      if (!validation.ok) return json(422, { message: validation.message });
      const result = await sendTicketReply(ticket, validation.reply, env);
      if (!result.ok) return json(result.status, { message: result.message });
      const repliedAt = new Date();
      await store.recordReply(ticketId, { message: validation.reply.message, emailId: result.id }, repliedAt);
      return json(200, { message: "Reply sent.", ticketId, repliedAt: repliedAt.toISOString() });
    }
    return json(404, { message: "Ticket action not found." });
  } catch (error) {
    console.error(`Dashboard ticket ${action} failed`, error);
    return json(500, { message: "The ticket could not be updated." });
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const store = new D1Store(env.DB);
  const ticketAction = url.pathname.match(/^\/api\/dashboard\/tickets\/(B\d{10})(?:\/(reply|archive|unarchive))?$/);
  if (ticketAction) return handleTicketAction(request, env, store, ticketAction[1], ticketAction[2] || "delete");
  if (url.pathname === "/api/support") return handleSupport(request, env, store);
  if (url.pathname === "/api/analytics/view") return handleAnalytics(request, env, store);
  if (url.pathname === "/api/dashboard/login") return handleDashboardLogin(request, env, store);
  if (url.pathname === "/api/dashboard/stats") return handleDashboardStats(request, env, store, url);
  if (url.pathname === "/api/dashboard/tickets") return handleDashboardTickets(request, env, store, url);
  if (url.pathname === "/api/dashboard/logout") {
    if (request.method !== "POST") return json(405, { message: "Method not allowed." });
    if (!allowed(request, env)) return json(403, { message: "Request origin is not allowed." });
    return json(200, { authenticated: false }, { "Set-Cookie": clearDashboardSessionCookie() });
  }
  if (url.pathname === "/api/dashboard/session") {
    if (request.method !== "GET") return json(405, { message: "Method not allowed." });
    return json(200, { authenticated: await dashboardAuthorized(request, env) });
  }
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...apiHeaders } });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(new D1Store(env.DB).cleanupRateLimits());
  },
};

export { handleRequest };
