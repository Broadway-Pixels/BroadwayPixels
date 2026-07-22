import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicPages = ["index.html", "music.html", "content.html", "projects.html", "support.html"];

test("homepage uses the Broadway Pixels creator and developer SEO title", async () => {
  const homepage = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(homepage, /<title>Broadway Pixels - Content Creator and Developer<\/title>/);
  assert.match(homepage, /property="og:title" content="Broadway Pixels - Content Creator and Developer"/);
});

test("every public page loads the early theme and offers a theme control", async () => {
  const pages = await Promise.all(publicPages.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  pages.forEach((page) => {
    assert.match(page, /<script src="\/theme\.js\?v=20260722-2"><\/script>/);
    assert.match(page, /data-theme-toggle/);
    assert.match(page, /script\.js\?v=20260722-7/);
  });
});

test("every public page links to the Broadway Pixels Discord", async () => {
  const pages = await Promise.all(publicPages.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  pages.forEach((page) => {
    assert.match(page, /href="https:\/\/discord\.gg\/KCVFeUZux"/);
    assert.match(page, /src="assets\/icon-discord\.svg"/);
  });
});

test("projects page includes the Pixelated Discord bot", async () => {
  const projects = await readFile(new URL("../projects.html", import.meta.url), "utf8");
  assert.match(projects, /id="pixelated"/);
  assert.match(projects, /<h2>Pixelated<\/h2>/);
  assert.match(projects, /A Discord bot for moderation logs, community commands, XP, and Broadway Pixels social updates\./);
});

test("dashboard stays out of search and public analytics", async () => {
  const dashboard = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");
  const clientScript = await readFile(new URL("../script.js", import.meta.url), "utf8");
  assert.match(dashboard, /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(clientScript, /trackedPages[^;]+dashboard/s);
});

test("visible site copy contains no em or en dashes", async () => {
  const files = [...publicPages, "dashboard.html"];
  const pages = await Promise.all(files.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  pages.forEach((page) => assert.doesNotMatch(page, /[—–]/));
});
