import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const files = [
  "index.html", "music.html", "projects.html", "support.html", "faq.html", "dashboard.html",
  "privacy.html", "styles.css", "script.js", "theme.js", "support.js", "dashboard.js",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map((file) => copyFile(new URL(file, root), new URL(file, output))));
await copyFile(new URL("content.html", root), new URL("videos.html", output));
await mkdir(new URL("tanktopia/", output), { recursive: true });
await copyFile(new URL("tanktopia-eula.html", root), new URL("tanktopia/eula.html", output));
await mkdir(new URL("steady/", output), { recursive: true });
await copyFile(new URL("steady-privacy.html", root), new URL("steady/privacy.html", output));
await copyFile(new URL("steady-terms.html", root), new URL("steady/terms.html", output));
await mkdir(new URL("assets/", output), { recursive: true });
const assets = await readdir(new URL("assets/", root), { withFileTypes: true });
await Promise.all(assets.filter((entry) => entry.isFile()).map((entry) => (
  copyFile(new URL(`assets/${entry.name}`, root), new URL(`assets/${entry.name}`, output))
)));

await writeFile(new URL("_headers", output), `/*
  Content-Security-Policy: default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self' mailto:; frame-ancestors 'none'
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

/dashboard
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow

https://:version.:subdomain.workers.dev/*
  X-Robots-Tag: noindex
`, "utf8");

await writeFile(new URL("_redirects", output), `/content /videos 308
/content.html /videos 308
/videos.html /videos 308
/tanktopia-eula /tanktopia/eula 308
/tanktopia-eula.html /tanktopia/eula 308
/steady-privacy /steady/privacy 308
/steady-privacy.html /steady/privacy 308
/steady-terms /steady/terms 308
/steady-terms.html /steady/terms 308
`, "utf8");

console.log(`Built Broadway Pixels static assets in ${join(output.pathname)}`);
