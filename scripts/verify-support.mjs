const baseUrl = String(process.argv[2] || "").replace(/\/$/, "");
const testEmail = process.argv[3];
if (!baseUrl.startsWith("https://") || !testEmail) throw new Error("Usage: credentials-json | node scripts/verify-support.mjs https://deployment.example test@example.com");

let input = "";
for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input);
const requestId = crypto.randomUUID();

const support = await fetch(`${baseUrl}/api/support`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({
    name: "Broadway Pixels",
    email: testEmail,
    project: "General",
    topic: "Cloudflare hosting migration test",
    message: "This is an automated production test of the migrated Broadway Pixels support and confirmation email flow.",
    link: "",
    company: "",
    requestId,
  }),
});
const supportBody = await support.json();
if (!support.ok || !supportBody.ticketId) throw new Error(`Support submission failed: ${support.status} ${supportBody.message || ""}`);

const login = await fetch(`${baseUrl}/api/dashboard/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify(credentials),
});
if (!login.ok) throw new Error(`Dashboard login failed: ${login.status}`);
const cookie = login.headers.get("set-cookie");
const tickets = await fetch(`${baseUrl}/api/dashboard/tickets?limit=250`, { headers: { Cookie: cookie } });
const ticketsBody = await tickets.json();
if (!tickets.ok || !ticketsBody.tickets?.some((ticket) => ticket.ticketId === supportBody.ticketId)) {
  throw new Error("Submitted support ticket was not recorded in D1");
}

const removal = await fetch(`${baseUrl}/api/dashboard/tickets/${supportBody.ticketId}`, {
  method: "DELETE",
  headers: { Cookie: cookie, Origin: baseUrl },
});
if (!removal.ok) throw new Error(`Test ticket cleanup failed: ${removal.status}`);
console.log(JSON.stringify({
  support: support.status,
  ticketId: supportBody.ticketId,
  confirmationSent: supportBody.confirmationSent,
  recordedInDashboard: true,
  testTicketDeleted: true,
}));
