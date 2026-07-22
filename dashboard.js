const loginSection = document.querySelector("#dashboard-login");
const contentSection = document.querySelector("#dashboard-content");
const loginForm = document.querySelector("#dashboard-login-form");
const loginStatus = document.querySelector("#dashboard-login-status");
const dashboardStatus = document.querySelector("#dashboard-status");
const logoutButton = document.querySelector("#dashboard-logout");
const rangeButtons = document.querySelectorAll("[data-days]");
let selectedDays = 30;

function setAuthenticated(authenticated) {
  loginSection.hidden = authenticated;
  contentSection.hidden = !authenticated;
  logoutButton.hidden = !authenticated;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function titleCase(value) {
  return String(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function renderList(target, items, labelKey) {
  target.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent = "No visits recorded in this range yet.";
    target.append(empty);
    return;
  }

  const max = Math.max(...items.map((item) => item.views), 1);
  items.slice(0, 6).forEach((item) => {
    const row = document.createElement("div");
    row.className = "dashboard-list-row";
    const copy = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = item[labelKey];
    const bar = document.createElement("span");
    bar.style.setProperty("--bar-width", `${Math.max(4, (item.views / max) * 100)}%`);
    const value = document.createElement("b");
    value.textContent = formatNumber(item.views);
    copy.append(label, bar);
    row.append(copy, value);
    target.append(row);
  });
}

function renderChart(daily) {
  const chart = document.querySelector("#traffic-chart");
  chart.replaceChildren();
  const displayed = daily.length > 31 ? daily.filter((_, index) => index % 3 === 0 || index === daily.length - 1) : daily;
  const max = Math.max(...displayed.map((item) => item.views), 1);

  displayed.forEach((item) => {
    const column = document.createElement("div");
    column.className = "traffic-column";
    column.title = `${item.date}: ${formatNumber(item.views)} page views`;
    const value = document.createElement("span");
    value.textContent = item.views ? formatNumber(item.views) : "";
    const bar = document.createElement("i");
    bar.style.setProperty("--bar-height", `${Math.max(3, (item.views / max) * 100)}%`);
    const label = document.createElement("small");
    const date = new Date(`${item.date}T00:00:00Z`);
    label.textContent = date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    column.append(value, bar, label);
    chart.append(column);
  });
}

function renderDevices(devices, total) {
  const target = document.querySelector("#device-breakdown");
  target.replaceChildren();
  if (!devices.length) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent = "No device data recorded yet.";
    target.append(empty);
    return;
  }
  devices.forEach((device) => {
    const item = document.createElement("div");
    const value = document.createElement("strong");
    value.textContent = total ? `${Math.round((device.views / total) * 100)}%` : "0%";
    const label = document.createElement("span");
    label.textContent = titleCase(device.device);
    item.append(value, label);
    target.append(item);
  });
}

function renderTickets(tickets) {
  const target = document.querySelector("#ticket-list");
  const count = document.querySelector("#ticket-count");
  target.replaceChildren();
  count.textContent = `${formatNumber(tickets.length)} ${tickets.length === 1 ? "ticket" : "tickets"}`;

  if (!tickets.length) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent = "No support tickets have been submitted yet.";
    target.append(empty);
    return;
  }

  tickets.forEach((ticket) => {
    const card = document.createElement("article");
    card.className = "ticket-card";

    const header = document.createElement("div");
    header.className = "ticket-card-header";
    const identity = document.createElement("div");
    const ticketId = document.createElement("strong");
    ticketId.className = "ticket-card-id";
    ticketId.textContent = ticket.ticketId;
    const meta = document.createElement("p");
    meta.className = "ticket-card-meta";
    meta.textContent = `${ticket.project} | ${ticket.name} | ${ticket.email}`;
    identity.append(ticketId, meta);
    const time = document.createElement("time");
    time.dateTime = ticket.createdAt;
    time.textContent = new Date(ticket.createdAt).toLocaleString();
    header.append(identity, time);

    const topic = document.createElement("h3");
    topic.textContent = ticket.topic;
    const message = document.createElement("p");
    message.className = "ticket-card-message";
    message.textContent = ticket.message;

    const footer = document.createElement("div");
    footer.className = "ticket-card-footer";
    const links = document.createElement("div");
    links.className = "ticket-links";
    const reply = document.createElement("a");
    reply.href = `mailto:${ticket.email}?subject=${encodeURIComponent(`[${ticket.ticketId}] ${ticket.topic}`)}`;
    reply.textContent = "Reply by email";
    links.append(reply);
    if (ticket.link) {
      const helpfulLink = document.createElement("a");
      helpfulLink.href = ticket.link;
      helpfulLink.target = "_blank";
      helpfulLink.rel = "noreferrer";
      helpfulLink.textContent = "Open helpful link";
      links.append(helpfulLink);
    }
    const confirmation = document.createElement("span");
    confirmation.className = `ticket-confirmation${ticket.confirmationSent ? "" : " ticket-confirmation-warning"}`;
    confirmation.textContent = ticket.confirmationSent ? "Confirmation sent" : "Confirmation needs follow-up";
    footer.append(links, confirmation);

    card.append(header, topic, message, footer);
    target.append(card);
  });
}

function renderStats(stats) {
  document.querySelector("#metric-views").textContent = formatNumber(stats.totals.pageViews);
  document.querySelector("#metric-sessions").textContent = formatNumber(stats.totals.sessions);
  document.querySelector("#metric-today").textContent = formatNumber(stats.totals.todayViews);
  document.querySelector("#metric-live").textContent = formatNumber(stats.totals.liveSessions);
  document.querySelector("#metric-range").textContent = `Last ${stats.rangeDays} days`;
  document.querySelector("#dashboard-updated").textContent = `Updated ${new Date(stats.generatedAt).toLocaleString()}`;
  renderChart(stats.daily);
  renderList(document.querySelector("#top-pages"), stats.pages, "name");
  renderList(document.querySelector("#traffic-sources"), stats.sources.map((source) => ({ ...source, source: source.source === "direct" ? "Direct" : source.source === "internal" ? "Broadway Pixels" : source.source })), "source");
  renderDevices(stats.devices, stats.totals.pageViews);
}

async function loadStats() {
  dashboardStatus.textContent = "Loading dashboard.";
  try {
    const [statsResponse, ticketsResponse] = await Promise.all([
      fetch(`/api/dashboard/stats?days=${selectedDays}`, { headers: { Accept: "application/json" } }),
      fetch("/api/dashboard/tickets?limit=100", { headers: { Accept: "application/json" } }),
    ]);
    if (statsResponse.status === 401 || ticketsResponse.status === 401) {
      setAuthenticated(false);
      dashboardStatus.textContent = "";
      return;
    }
    const [result, ticketResult] = await Promise.all([statsResponse.json(), ticketsResponse.json()]);
    if (!statsResponse.ok) throw new Error(result.message || "Stats could not be loaded.");
    if (!ticketsResponse.ok) throw new Error(ticketResult.message || "Tickets could not be loaded.");
    setAuthenticated(true);
    renderStats(result);
    renderTickets(ticketResult.tickets || []);
    dashboardStatus.textContent = "";
  } catch (error) {
    dashboardStatus.textContent = error.message;
    dashboardStatus.className = "dashboard-status dashboard-status-error";
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  loginStatus.textContent = "Signing in.";
  loginStatus.className = "form-status form-status-pending";
  const formData = new FormData(loginForm);
  try {
    const response = await fetch("/api/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Sign in failed.");
    loginForm.reset();
    loginStatus.textContent = "";
    await loadStats();
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.className = "form-status form-status-error";
  } finally {
    submitButton.disabled = false;
  }
});

logoutButton?.addEventListener("click", async () => {
  await fetch("/api/dashboard/logout", { method: "POST", headers: { Accept: "application/json" } });
  setAuthenticated(false);
});

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedDays = Number(button.dataset.days);
    rangeButtons.forEach((item) => item.classList.toggle("active", item === button));
    loadStats();
  });
});

async function initializeDashboard() {
  try {
    const response = await fetch("/api/dashboard/session", { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (result.authenticated) await loadStats();
    else setAuthenticated(false);
  } catch {
    setAuthenticated(false);
  }
}

initializeDashboard();
