const projects = new Set([
  "Vidioza",
  "Tanktopia",
  "KixKan",
  "Music",
  "Content",
  "Partnerships",
  "General question",
]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requestIdPattern = /^[a-zA-Z0-9-]{8,80}$/;

const clean = (value) => typeof value === "string" ? value.trim() : "";
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[character]);

export function validateSupportSubmission(input) {
  const submission = {
    name: clean(input?.name),
    email: clean(input?.email).toLowerCase(),
    project: clean(input?.project),
    topic: clean(input?.topic),
    message: clean(input?.message),
    link: clean(input?.link),
    company: clean(input?.company),
    requestId: clean(input?.requestId),
  };

  if (submission.company) return { ok: false, silent: true, message: "Request received." };
  if (submission.name.length < 2 || submission.name.length > 80) return { ok: false, message: "Enter a valid name." };
  if (submission.email.length > 254 || !emailPattern.test(submission.email)) return { ok: false, message: "Enter a valid email address." };
  if (!projects.has(submission.project)) return { ok: false, message: "Choose a valid project." };
  if (submission.topic.length < 2 || submission.topic.length > 120) return { ok: false, message: "Enter a short description of the issue." };
  if (submission.message.length < 20 || submission.message.length > 5000) return { ok: false, message: "Add at least 20 characters and no more than 5,000." };
  if (submission.link) {
    try {
      const url = new URL(submission.link);
      if (!["http:", "https:"].includes(url.protocol) || submission.link.length > 500) throw new Error("Invalid URL");
    } catch {
      return { ok: false, message: "Enter a valid http or https link." };
    }
  }
  if (!requestIdPattern.test(submission.requestId)) return { ok: false, message: "Refresh the page and try again." };

  return { ok: true, submission };
}

export function isAllowedOrigin(headers, allowedOrigins = "") {
  const origin = headers.origin;
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    if (headers.host && originUrl.host === headers.host) return true;
    const configured = allowedOrigins.split(",").map((value) => value.trim()).filter(Boolean);
    return configured.includes(originUrl.origin);
  } catch {
    return false;
  }
}

export async function sendSupportEmail(submission, env, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.SUPPORT_FROM_EMAIL) {
    return { ok: false, status: 503, message: "Support email is not configured." };
  }

  const to = env.SUPPORT_TO_EMAIL || "Media@BroadwayPixels.com";
  const safe = Object.fromEntries(Object.entries(submission).map(([key, value]) => [key, escapeHtml(value)]));
  const subjectTopic = submission.topic.replace(/[\r\n]+/g, " ");
  const text = [
    `Project: ${submission.project}`,
    `Name: ${submission.name}`,
    `Email: ${submission.email}`,
    submission.link ? `Link: ${submission.link}` : "Link: Not provided",
    "",
    submission.message,
  ].join("\n");
  const html = `
    <h1>New Broadway Pixels support request</h1>
    <p><strong>Project:</strong> ${safe.project}</p>
    <p><strong>Name:</strong> ${safe.name}</p>
    <p><strong>Email:</strong> ${safe.email}</p>
    <p><strong>Helpful link:</strong> ${safe.link ? `<a href="${safe.link}">${safe.link}</a>` : "Not provided"}</p>
    <h2>${safe.topic}</h2>
    <p>${safe.message.replace(/\n/g, "<br>")}</p>
  `;

  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `support-${submission.requestId}`,
      },
      body: JSON.stringify({
        from: env.SUPPORT_FROM_EMAIL,
        to: [to],
        reply_to: submission.email,
        subject: `[${submission.project}] ${subjectTopic}`,
        html,
        text,
        tags: [{ name: "project", value: submission.project.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 256) }],
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) return { ok: false, status: 502, message: "Email service is temporarily unavailable." };
    return { ok: true, status: 200, id: result.id };
  } catch (error) {
    console.error("Resend request failed", error);
    return { ok: false, status: 502, message: "Email service is temporarily unavailable." };
  }
}
