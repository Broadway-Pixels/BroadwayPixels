document.documentElement.classList.add("js");

document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
  button.addEventListener("click", () => window.BroadwayPixelsTheme?.cycleTheme());
});
window.BroadwayPixelsTheme?.applyTheme();

const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector(".site-nav");

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  nav?.classList.toggle("open", !isOpen);
});

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton?.setAttribute("aria-expanded", "false");
    nav.classList.remove("open");
  });
});

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = document.querySelectorAll(".reveal");

if (reduceMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealItems.forEach((item) => observer.observe(item));
}

function anonymousSessionId() {
  const key = "bp-analytics-session";
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return "";
  }
}

function trafficSource() {
  if (!document.referrer) return "direct";
  try {
    const referrer = new URL(document.referrer);
    const hostname = referrer.hostname.toLowerCase();
    return hostname === "broadwaypixels.com" || hostname.endsWith(".broadwaypixels.com") ? "internal" : hostname;
  } catch {
    return "direct";
  }
}

function deviceClass() {
  if (window.innerWidth < 700) return "mobile";
  if (window.innerWidth < 1024) return "tablet";
  return "desktop";
}

function recordPageView() {
  const trackedPages = new Set(["/", "/music", "/videos", "/projects", "/support"]);
  if (!trackedPages.has(window.location.pathname)) return;
  if (!["broadwaypixels.com", "www.broadwaypixels.com"].includes(window.location.hostname)) return;
  if (navigator.doNotTrack === "1") return;
  const sessionId = anonymousSessionId();
  if (!sessionId) return;

  fetch("/api/analytics/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: window.location.pathname, sessionId, source: trafficSource(), device: deviceClass() }),
    keepalive: true,
  }).catch(() => {
    // Analytics never interrupts the visitor experience.
  });
}

recordPageView();
