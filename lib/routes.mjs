const pages = new Map([
  ["/", "/index.html"],
  ["/music", "/music.html"],
  ["/videos", "/content.html"],
  ["/projects", "/projects.html"],
  ["/support", "/support.html"],
  ["/faq", "/faq.html"],
  ["/dashboard", "/dashboard.html"],
  ["/privacy", "/privacy.html"],
  ["/tanktopia/eula", "/tanktopia-eula.html"],
]);

const legacyPages = new Map([
  ["/index.html", "/"],
  ["/music.html", "/music"],
  ["/content.html", "/videos"],
  ["/projects.html", "/projects"],
  ["/support.html", "/support"],
  ["/faq.html", "/faq"],
  ["/dashboard.html", "/dashboard"],
  ["/privacy.html", "/privacy"],
  ["/tanktopia-eula.html", "/tanktopia/eula"],
  ["/music/", "/music"],
  ["/videos/", "/videos"],
  ["/projects/", "/projects"],
  ["/support/", "/support"],
  ["/faq/", "/faq"],
  ["/dashboard/", "/dashboard"],
  ["/privacy/", "/privacy"],
  ["/tanktopia/eula/", "/tanktopia/eula"],
]);

export function resolvePublicRequest(pathname) {
  if (legacyPages.has(pathname)) return { type: "redirect", location: legacyPages.get(pathname) };
  if (pages.has(pathname)) return { type: "file", file: pages.get(pathname) };
  return { type: "file", file: pathname };
}
