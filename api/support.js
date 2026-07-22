import { isAllowedOrigin, sendSupportEmails, validateSupportSubmission } from "../lib/support.mjs";
import { createTicketId } from "../lib/tickets.mjs";

const attempts = new Map();
const windowMs = 10 * 60 * 1000;
const maxAttempts = 5;

function isRateLimited(ip) {
  if (attempts.size > 10_000) attempts.clear();
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > maxAttempts;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ message: "Method not allowed." });
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) return response.status(415).json({ message: "Content type must be application/json." });
  if (!isAllowedOrigin(request.headers, process.env.ALLOWED_ORIGINS)) return response.status(403).json({ message: "Request origin is not allowed." });

  const ip = String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) return response.status(429).json({ message: "Too many requests. Try again in a few minutes." });

  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return response.status(400).json({ message: "Request body must be valid JSON." }); }
  }
  const validation = validateSupportSubmission(body);
  if (!validation.ok) {
    if (validation.silent) return response.status(200).json({ message: validation.message });
    return response.status(422).json({ message: validation.message });
  }

  const ticketId = createTicketId(validation.submission.requestId);
  const result = await sendSupportEmails(validation.submission, ticketId, process.env);
  if (!result.ok) return response.status(result.status).json({ message: result.message });
  return response.status(200).json({ message: "Support request sent.", ticketId, confirmationSent: result.confirmationSent });
}
