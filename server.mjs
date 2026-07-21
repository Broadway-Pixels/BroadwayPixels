import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedOrigin, sendSupportEmail, validateSupportSubmission } from "./lib/support.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 8080);
const attempts = new Map();
const windowMs = 10 * 60 * 1000;
const maxAttempts = 5;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const publicFiles = new Set(["/index.html", "/music.html", "/content.html", "/projects.html", "/support.html", "/styles.css", "/script.js", "/support.js"]);

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function isRateLimited(ip) {
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
  if (isRateLimited(request.socket.remoteAddress || "unknown")) return json(response, 429, { message: "Too many requests. Try again in a few minutes." });

  try {
    const validation = validateSupportSubmission(await readJson(request));
    if (!validation.ok) {
      if (validation.silent) return json(response, 200, { message: validation.message });
      return json(response, 422, { message: validation.message });
    }
    const result = await sendSupportEmail(validation.submission, process.env);
    if (!result.ok) return json(response, result.status, { message: result.message });
    return json(response, 200, { message: "Support request sent.", id: result.id });
  } catch {
    return json(response, 400, { message: "Request body must be valid JSON." });
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/support") return handleSupport(request, response);
  if (!["GET", "HEAD"].includes(request.method)) return json(response, 405, { message: "Method not allowed." });

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!publicFiles.has(requested) && !requested.startsWith("/assets/")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }
  const filePath = normalize(join(root, requested));
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Content-Security-Policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self' mailto:; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  if (request.method === "HEAD") return response.end();
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Broadway Pixels listening on http://127.0.0.1:${port}`);
});
