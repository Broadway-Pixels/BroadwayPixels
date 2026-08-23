import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicPages = ["index.html", "music.html", "content.html", "projects.html", "support.html", "faq.html", "privacy.html", "tanktopia-eula.html"];

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
    assert.match(page, /script\.js\?v=20260724-1/);
  });
});

test("every public page links to the Broadway Pixels Discord", async () => {
  const pages = await Promise.all(publicPages.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  pages.forEach((page) => {
    assert.match(page, /href="https:\/\/discord\.gg\/KCVFeUZux"/);
    assert.match(page, /src="\/?assets\/icon-discord\.svg"/);
  });
});

test("projects page includes the Pixelated Discord bot", async () => {
  const projects = await readFile(new URL("../projects.html", import.meta.url), "utf8");
  assert.match(projects, /id="pixelated"/);
  assert.match(projects, /<h2>Pixelated<\/h2>/);
  assert.match(projects, /A Discord bot for moderation logs, community commands, XP, and custom rank cards\./);
});

test("FAQ page answers common music and AI questions", async () => {
  const faq = await readFile(new URL("../faq.html", import.meta.url), "utf8");
  const support = await readFile(new URL("../support.html", import.meta.url), "utf8");
  assert.match(faq, /<h1>Questions, answered\.<\/h1>/);
  assert.match(faq, /Is any of your music made with AI\?/);
  assert.match(faq, /Every Broadway Pixels release is written, arranged, produced, and finished by myself\./);
  assert.match(faq, /AI is used in some software projects and video workflows, but never to make the songs\./);
  assert.match(faq, /"@type": "FAQPage"/);
  assert.doesNotMatch(support, /<section class="faq-section"/);
});

test("every public page offers Contact and FAQ under Support", async () => {
  const pages = await Promise.all(publicPages.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  pages.forEach((page) => {
    assert.match(page, /<details class="nav-group">/);
    assert.match(page, /href="\/support"[^>]*>Contact<\/a>/);
    assert.match(page, /href="\/faq"[^>]*>FAQ<\/a>/);
  });
});

test("Tanktopia legal pages disclose current local behavior and user data routes", async () => {
  const privacy = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  const eula = await readFile(new URL("../tanktopia-eula.html", import.meta.url), "utf8");
  for (const page of [privacy, eula]) {
    assert.match(page, /Last updated 2026-08-03/);
    assert.match(page, /support@broadwaypixels\.com/);
    assert.match(page, /local|offline/i);
    assert.match(page, /store (?:availability|approval)/i);
  }
  assert.match(privacy, /Settings &gt; Privacy &amp; Data/);
  assert.match(privacy, /export|delete/i);
  assert.match(privacy, /does not forward analytics|forwarding is disabled/i);
  assert.match(eula, /in-development/i);
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
