import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { AnalyticsStore, validatePageView } from "./lib/analytics.mjs";
import {
  clearDashboardSessionCookie,
  createDashboardSession,
  dashboardConfigured,
  dashboardSessionCookie,
  readDashboardSession,
  verifyDashboardCredentials,
  verifyDashboardSession,
} from "./lib/dashboard-auth.mjs";
import { resolvePublicRequest } from "./lib/routes.mjs";
import { isAllowedOrigin, sendSupportEmails, sendTicketReply, validateSupportSubmission, validateTicketReply } from "./lib/support.mjs";
import { createTicketId, TicketStore } from "./lib/tickets.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 8080);
const supportAttempts = new Map();
const analyticsAttempts = new Map();
const loginAttempts = new Map();
const dashboardActionAttempts = new Map();
const analyticsStore = new AnalyticsStore(process.env.ANALYTICS_DATA_DIR || join(root, "data", "analytics"));
const ticketStore = new TicketStore(process.env.SUPPORT_DATA_DIR || join(root, "data", "tickets"));
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
const publicFiles = new Set(["/index.html", "/music.html", "/content.html", "/projects.html", "/support.html", "/dashboard.html", "/styles.css", "/script.js", "/theme.js", "/support.js", "/dashboard.js"]);

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(body));
}

function clientAddress(request) {
  return String(request.headers["x-real-ip"] || request.socket.remoteAddress || "unknown").slice(0, 64);
}

function isRateLimited(attempts, ip, maxAttempts, windowMs) {
  if (attempts.size > 10_000) attempts.clear();
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > maxAttempts;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}

async function handleSupport(request, response) {
  if (request.method !== "POST") return json(response, 405, { message: "Method not allowed." });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) return json(response, 415, { message: "Content type must be application/json." });
  if (!isAllowedOrigin(request.headers, process.env.ALLOWED_ORIGINS)) return json(response, 403, { message: "Request origin is not allowed." });
  if (isRateLimited(supportAttempts, clientAddress(request), 5, 10 * 60 * 1000)) return json(response, 429, { message: "Too many requests. Try again in a few minutes." });

  let body;
  try {
    body = await readJson(request);
  } catch {
    return json(response, 400, { message: "Request body must be valid JSON." });
  }
  const validation = validateSupportSubmission(body);
  if (!validation.ok) {
    if (validation.silent) return json(response, 200, { message: validation.message });
    return json(response, 422, { message: validation.message });
  }

  const ticketId = createTicketId(validation.submission.requestId);
  const result = await sendSupportEmails(validation.submission, ticketId, process.env);
  if (!result.ok) return json(response, result.status, { message: result.message });

  try {
    await ticketStore.record({
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
    return json(response, 500, { message: "Your email was sent, but the ticket could not be recorded. Please submit again." });
  }

  return json(response, 200, {
    message: "Support request sent.",
    ticketId,
    confirmationSent: result.confirmationSent,
  });
}

async function handleAnalytics(request, response) {
  if (request.method !== "POST") return json(response, 405, { message: "Method not allowed." });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) return json(response, 415, { message: "Content type must be application/json." });
  if (!isAllowedOrigin(request.headers, process.env.ALLOWED_ORIGINS)) return json(response, 403, { message: "Request origin is not allowed." });
  if (isRateLimited(analyticsAttempts, clientAddress(request), 200, 10 * 60 * 1000)) return json(response, 429, { message: "Too many requests." });

  let validation;
  try {
    validation = validatePageView(await readJson(request));
  } catch {
    return json(response, 400, { message: "Request body must be valid JSON." });
  }
  if (!validation.ok) return json(response, 422, { message: validation.message });
  try {
    await analyticsStore.record(validation.event);
    return json(response, 202, { recorded: true });
  } catch (error) {
    console.error("Analytics recording failed", error);
    return json(response, 500, { message: "Analytics are temporarily unavailable." });
  }
}

function dashboardAuthorized(request) {
  const token = readDashboardSession(request.headers.cookie);
  return verifyDashboardSession(token, process.env);
}

async function handleDashboardLogin(request, response) {
  if (request.method !== "POST") return json(response, 405, { message: "Method not allowed." });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) return json(response, 415, { message: "Content type must be application/json." });
  if (!isAllowedOrigin(request.headers, process.env.ALLOWED_ORIGINS)) return json(response, 403, { message: "Request origin is not allowed." });
  if (!dashboardConfigured(process.env)) return json(response, 503, { message: "Dashboard access is not configured." });
  if (isRateLimited(loginAttempts, clientAddress(request), 10, 15 * 60 * 1000)) return json(response, 429, { message: "Too many sign-in attempts. Try again later." });

  try {
    const credentials = await readJson(request);
    if (!verifyDashboardCredentials(credentials, process.env)) return json(response, 401, { message: "Username or password is incorrect." });
    const secure = request.headers["x-forwarded-proto"] === "https";
    const session = createDashboardSession(process.env);
    return json(response, 200, { authenticated: true }, { "Set-Cookie": dashboardSessionCookie(session, secure) });
  } catch {
    return json(response, 400, { message: "Request body must be valid JSON." });
  }
}

async function handleDashboardStats(request, response, url) {
  if (request.method !== "GET") return json(response, 405, { message: "Method not allowed." });
  if (!dashboardAuthorized(request)) return json(response, 401, { message: "Sign in to view website stats." });
  try {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
    return json(response, 200, await analyticsStore.stats(days));
  } catch (error) {
    console.error("Dashboard stats failed", error);
    return json(response, 500, { message: "Stats are temporarily unavailable." });
  }
}

async function handleDashboardTickets(request, response, url) {
  if (request.method !== "GET") return json(response, 405, { message: "Method not allowed." });
  if (!dashboardAuthorized(request)) return json(response, 401, { message: "Sign in to view support tickets." });
  try {
    const limit = Math.min(250, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const tickets = (await ticketStore.list(limit, { status: "all" })).map((ticket) => ({
      ticketId: ticket.ticketId,
      name: ticket.name,
      email: ticket.email,
      project: ticket.project,
      topic: ticket.topic,
      message: ticket.message,
      link: ticket.link,
      confirmationSent: ticket.confirmationSent,
      createdAt: ticket.createdAt,
      status: ticket.status === "archived" ? "archived" : "open",
      replyCount: Array.isArray(ticket.replies) ? ticket.replies.length : 0,
      lastRepliedAt: Array.isArray(ticket.replies) ? ticket.replies.at(-1)?.sentAt || "" : "",
    }));
    return json(response, 200, { tickets, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Dashboard tickets failed", error);
    return json(response, 500, { message: "Support tickets are temporarily unavailable." });
  }
}

async function handleDashboardTicketAction(request, response, ticketId, action) {
  if (!dashboardAuthorized(request)) return json(response, 401, { message: "Sign in to manage support tickets." });
  if (!request.headers.origin || !isAllowedOrigin(request.headers, process.env.ALLOWED_ORIGINS)) return json(response, 403, { message: "Request origin is not allowed." });
  if (isRateLimited(dashboardActionAttempts, clientAddress(request), 40, 10 * 60 * 1000)) return json(response, 429, { message: "Too many dashboard actions. Try again in a few minutes." });

  try {
    const ticket = await ticketStore.get(ticketId);
    if (!ticket) return json(response, 404, { message: "Ticket not found." });

    if (action === "delete") {
      if (request.method !== "DELETE") return json(response, 405, { message: "Method not allowed." });
      await ticketStore.remove(ticketId);
      return json(response, 200, { deleted: true, ticketId });
    }

    if (request.method !== "POST") return json(response, 405, { message: "Method not allowed." });
    if (action === "archive" || action === "unarchive") {
      await ticketStore.archive(ticketId, action === "archive");
      return json(response, 200, { ticketId, status: action === "archive" ? "archived" : "open" });
    }

    if (action === "reply") {
      if (!String(request.headers["content-type"] || "").startsWith("application/json")) return json(response, 415, { message: "Content type must be application/json." });
      let body;
      try {
        body = await readJson(request);
      } catch {
        return json(response, 400, { message: "Request body must be valid JSON." });
      }
      const validation = validateTicketReply(body);
      if (!validation.ok) return json(response, 422, { message: validation.message });
      const result = await sendTicketReply(ticket, validation.reply, process.env);
      if (!result.ok) return json(response, result.status, { message: result.message });
      await ticketStore.recordReply(ticketId, { message: validation.reply.message, emailId: result.id });
      return json(response, 200, { message: "Reply sent.", ticketId, repliedAt: new Date().toISOString() });
    }

    return json(response, 404, { message: "Ticket action not found." });
  } catch (error) {
    console.error(`Dashboard ticket ${action} failed`, error);
    return json(response, 500, { message: "The ticket could not be updated." });
  }
}

function handleDashboardLogout(request, response) {
  if (request.method !== "POST") return json(response, 405, { message: "Method not allowed." });
  if (!isAllowedOrigin(request.headers, process.env.ALLOWED_ORIGINS)) return json(response, 403, { message: "Request origin is not allowed." });
  const secure = request.headers["x-forwarded-proto"] === "https";
  return json(response, 200, { authenticated: false }, { "Set-Cookie": clearDashboardSessionCookie(secure) });
}

function handleDashboardSession(request, response) {
  if (request.method !== "GET") return json(response, 405, { message: "Method not allowed." });
  return json(response, 200, { authenticated: dashboardAuthorized(request) });
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const ticketAction = url.pathname.match(/^\/api\/dashboard\/tickets\/(B\d{10})(?:\/(reply|archive|unarchive))?$/);
  if (ticketAction) return handleDashboardTicketAction(request, response, ticketAction[1], ticketAction[2] || "delete");
  if (url.pathname === "/api/support") return handleSupport(request, response);
  if (url.pathname === "/api/analytics/view") return handleAnalytics(request, response);
  if (url.pathname === "/api/dashboard/login") return handleDashboardLogin(request, response);
  if (url.pathname === "/api/dashboard/stats") return handleDashboardStats(request, response, url);
  if (url.pathname === "/api/dashboard/tickets") return handleDashboardTickets(request, response, url);
  if (url.pathname === "/api/dashboard/logout") return handleDashboardLogout(request, response);
  if (url.pathname === "/api/dashboard/session") return handleDashboardSession(request, response);
  if (!["GET", "HEAD"].includes(request.method)) return json(response, 405, { message: "Method not allowed." });

  const route = resolvePublicRequest(url.pathname);
  if (route.type === "redirect") {
    response.writeHead(308, { Location: `${route.location}${url.search}`, "Cache-Control": "public, max-age=3600" });
    return response.end();
  }

  const requested = route.file;
  if (!publicFiles.has(requested) && !requested.startsWith("/assets/")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }
  const filePath = normalize(join(root, requested));
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }

  const responseHeaders = {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Content-Security-Policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self' mailto:; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
  if (requested === "/dashboard.html") {
    responseHeaders["Cache-Control"] = "no-store";
    responseHeaders["X-Robots-Tag"] = "noindex, nofollow";
  }
  response.writeHead(200, responseHeaders);
  if (request.method === "HEAD") return response.end();
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Broadway Pixels listening on http://127.0.0.1:${port}`);
});
