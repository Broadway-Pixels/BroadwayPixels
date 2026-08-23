import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicRequest } from "../lib/routes.mjs";

test("serves clean public page routes from the existing HTML templates", () => {
  assert.deepEqual(resolvePublicRequest("/"), { type: "file", file: "/index.html" });
  assert.deepEqual(resolvePublicRequest("/music"), { type: "file", file: "/music.html" });
  assert.deepEqual(resolvePublicRequest("/videos"), { type: "file", file: "/content.html" });
  assert.deepEqual(resolvePublicRequest("/projects"), { type: "file", file: "/projects.html" });
  assert.deepEqual(resolvePublicRequest("/support"), { type: "file", file: "/support.html" });
  assert.deepEqual(resolvePublicRequest("/faq"), { type: "file", file: "/faq.html" });
  assert.deepEqual(resolvePublicRequest("/dashboard"), { type: "file", file: "/dashboard.html" });
  assert.deepEqual(resolvePublicRequest("/privacy"), { type: "file", file: "/privacy.html" });
  assert.deepEqual(resolvePublicRequest("/tanktopia/eula"), { type: "file", file: "/tanktopia-eula.html" });
});

test("redirects legacy HTML and trailing-slash URLs", () => {
  assert.deepEqual(resolvePublicRequest("/index.html"), { type: "redirect", location: "/" });
  assert.deepEqual(resolvePublicRequest("/content.html"), { type: "redirect", location: "/videos" });
  assert.deepEqual(resolvePublicRequest("/support/"), { type: "redirect", location: "/support" });
  assert.deepEqual(resolvePublicRequest("/faq.html"), { type: "redirect", location: "/faq" });
  assert.deepEqual(resolvePublicRequest("/faq/"), { type: "redirect", location: "/faq" });
  assert.deepEqual(resolvePublicRequest("/dashboard.html"), { type: "redirect", location: "/dashboard" });
  assert.deepEqual(resolvePublicRequest("/privacy.html"), { type: "redirect", location: "/privacy" });
  assert.deepEqual(resolvePublicRequest("/tanktopia-eula.html"), { type: "redirect", location: "/tanktopia/eula" });
  assert.deepEqual(resolvePublicRequest("/privacy/"), { type: "redirect", location: "/privacy" });
  assert.deepEqual(resolvePublicRequest("/tanktopia/eula/"), { type: "redirect", location: "/tanktopia/eula" });
});

test("leaves asset and unknown paths for the public-file allowlist", () => {
  assert.deepEqual(resolvePublicRequest("/assets/logo.png"), { type: "file", file: "/assets/logo.png" });
  assert.deepEqual(resolvePublicRequest("/missing"), { type: "file", file: "/missing" });
});
