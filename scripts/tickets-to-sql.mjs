import { readFile } from "node:fs/promises";

const input = process.argv[2];
if (!input) throw new Error("Usage: node scripts/tickets-to-sql.mjs /path/to/tickets.ndjson");

const quote = (value) => `'${String(value ?? "").replace(/'/g, "''")}'`;
const lines = (await readFile(input, "utf8")).split("\n").filter(Boolean);

for (const line of lines) {
  const ticket = JSON.parse(line);
  const createdAt = ticket.createdAt || new Date().toISOString();
  const updatedAt = ticket.updatedAt || createdAt;
  const values = [
    ticket.ticketId, ticket.name, ticket.email, ticket.project, ticket.topic, ticket.message,
    ticket.link || "", ticket.confirmationSent ? 1 : 0, ticket.notificationEmailId || "",
    ticket.confirmationEmailId || "", ticket.status === "archived" ? "archived" : "open", createdAt, updatedAt,
  ].map(quote).join(", ");
  console.log(`INSERT OR IGNORE INTO tickets (ticket_id, name, email, project, topic, message, link, confirmation_sent, notification_email_id, confirmation_email_id, status, created_at, updated_at) VALUES (${values});`);
  for (const reply of Array.isArray(ticket.replies) ? ticket.replies : []) {
    console.log(`INSERT INTO ticket_replies (ticket_id, message, email_id, sent_at) VALUES (${quote(ticket.ticketId)}, ${quote(reply.message)}, ${quote(reply.emailId || "")}, ${quote(reply.sentAt || updatedAt)});`);
  }
}
