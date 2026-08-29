const baseUrl = String(process.argv[2] || "").replace(/\/$/, "");
if (!baseUrl.startsWith("https://")) throw new Error("Usage: credentials-json | node scripts/verify-cloudflare.mjs https://deployment.example");

let input = "";
for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input);

const homepage = await fetch(`${baseUrl}/`);
const homeText = await homepage.text();
if (!homepage.ok || !homeText.includes("Broadway Pixels - Content Creator and Developer")) throw new Error("Homepage verification failed");

const legacy = await fetch(`${baseUrl}/content.html`, { redirect: "manual" });
if (legacy.status !== 308 || legacy.headers.get("location") !== "/videos") throw new Error("Legacy redirect verification failed");

const analytics = await fetch(`${baseUrl}/api/analytics/view`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({
    path: "/projects",
    sessionId: crypto.randomUUID(),
    device: "desktop",
    source: "direct",
  }),
});
if (analytics.status !== 202) throw new Error(`Analytics verification failed: ${analytics.status}`);

const login = await fetch(`${baseUrl}/api/dashboard/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify(credentials),
});
if (!login.ok) throw new Error(`Dashboard login failed: ${login.status}`);
const cookie = login.headers.get("set-cookie");
if (!cookie) throw new Error("Dashboard login did not set a session cookie");

const [stats, tickets] = await Promise.all([
  fetch(`${baseUrl}/api/dashboard/stats?days=30`, { headers: { Cookie: cookie } }),
  fetch(`${baseUrl}/api/dashboard/tickets?limit=250`, { headers: { Cookie: cookie } }),
]);
if (!stats.ok || !tickets.ok) throw new Error(`Dashboard reads failed: stats=${stats.status}, tickets=${tickets.status}`);
const statsBody = await stats.json();
const ticketsBody = await tickets.json();
console.log(JSON.stringify({
  homepage: homepage.status,
  legacyRedirect: legacy.status,
  analytics: analytics.status,
  dashboardLogin: login.status,
  dashboardStats: stats.status,
  dashboardTickets: tickets.status,
  pageViews: statsBody.totals?.pageViews,
  ticketCount: ticketsBody.tickets?.length,
}));
