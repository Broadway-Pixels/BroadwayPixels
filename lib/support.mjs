const projects = new Set([
  "Vidioza",
  "Tanktopia",
  "KixKan",
  "Pixelated",
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

export function validateTicketReply(input) {
  const message = clean(input?.message);
  const requestId = clean(input?.requestId);
  if (message.length < 2 || message.length > 5000) return { ok: false, message: "Write a reply between 2 and 5,000 characters." };
  if (!requestIdPattern.test(requestId)) return { ok: false, message: "Refresh the dashboard and try again." };
  return { ok: true, reply: { message, requestId } };
}

async function postResendEmail(payload, idempotencyKey, env, fetchImpl) {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  return response.ok && result.id ? { ok: true, id: result.id } : { ok: false };
}

export async function sendTicketReply(ticket, reply, env, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.SUPPORT_FROM_EMAIL) {
    return { ok: false, status: 503, message: "Support email is not configured." };
  }

  const safeName = escapeHtml(ticket.name);
  const safeTicketId = escapeHtml(ticket.ticketId);
  const safeMessage = escapeHtml(reply.message);
  const subjectTopic = String(ticket.topic).replace(/[\r\n]+/g, " ");
  const replyTo = env.SUPPORT_TO_EMAIL || "Media@BroadwayPixels.com";
  const logoUrl = env.SUPPORT_LOGO_URL || "https://broadwaypixels.com/assets/broadway-pixels-logo-v2.png?v=20260722-1";
  try {
    const result = await postResendEmail({
      from: env.SUPPORT_FROM_EMAIL,
      to: [ticket.email],
      reply_to: replyTo,
      subject: `[${ticket.ticketId}] Re: ${subjectTopic}`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10224a;line-height:1.6;max-width:620px;margin:auto">
          <img src="${logoUrl}" alt="Broadway Pixels" width="190" style="display:block;width:190px;max-width:45%;height:auto;margin:0 0 24px">
          <p style="color:#1557d6;font-weight:700;margin:0">Ticket ${safeTicketId}</p>
          <h1 style="margin:4px 0 18px">A reply from Broadway Pixels</h1>
          <p>Hi ${safeName},</p>
          <div style="background:#eef4ff;border:1px solid #bfd3f7;border-radius:12px;padding:18px 20px;margin:24px 0">
            <p style="margin:0;white-space:pre-wrap">${safeMessage.replace(/\n/g, "<br>")}</p>
          </div>
          <p>Reply to this email if you need anything else. Please keep <strong>${safeTicketId}</strong> in the subject line.</p>
        </div>
      `,
      text: [
        `Hi ${ticket.name},`,
        "",
        reply.message,
        "",
        `Reply to this email if you need anything else. Please keep ${ticket.ticketId} in the subject line.`,
      ].join("\n"),
      tags: [{ name: "project", value: String(ticket.project).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 256) }, { name: "type", value: "support_reply" }],
    }, `support-reply-${ticket.ticketId}-${reply.requestId}`, env, fetchImpl);
    return result.ok
      ? { ok: true, status: 200, id: result.id }
      : { ok: false, status: 502, message: "Email service is temporarily unavailable." };
  } catch (error) {
    console.error(`Support reply failed for ${ticket.ticketId}`, error);
    return { ok: false, status: 502, message: "Email service is temporarily unavailable." };
  }
}

export async function sendSupportEmails(submission, ticketId, env, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.SUPPORT_FROM_EMAIL) {
    return { ok: false, status: 503, message: "Support email is not configured." };
  }

  const to = env.SUPPORT_TO_EMAIL || "Media@BroadwayPixels.com";
  const safe = Object.fromEntries(Object.entries(submission).map(([key, value]) => [key, escapeHtml(value)]));
  const safeTicketId = escapeHtml(ticketId);
  const subjectTopic = submission.topic.replace(/[\r\n]+/g, " ");
  const logoUrl = env.SUPPORT_LOGO_URL || "https://broadwaypixels.com/assets/broadway-pixels-logo-v2.png?v=20260722-1";
  const projectTag = submission.project.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 256);
  const adminText = [
    `Ticket: ${ticketId}`,
    `Project: ${submission.project}`,
    `Name: ${submission.name}`,
    `Email: ${submission.email}`,
    submission.link ? `Link: ${submission.link}` : "Link: Not provided",
    "",
    submission.message,
  ].join("\n");
  const adminHtml = `
    <div style="font-family:Arial,sans-serif;color:#10224a;line-height:1.6;max-width:680px;margin:auto">
    <img src="${logoUrl}" alt="Broadway Pixels" width="190" style="display:block;width:190px;max-width:45%;height:auto;margin:0 0 24px">
    <p style="color:#1557d6;font-weight:700;margin:0">Ticket ${safeTicketId}</p>
    <h1 style="margin:4px 0 24px">New Broadway Pixels support request</h1>
    <p><strong>Project:</strong> ${safe.project}</p>
    <p><strong>Name:</strong> ${safe.name}</p>
    <p><strong>Email:</strong> ${safe.email}</p>
    <p><strong>Helpful link:</strong> ${safe.link ? `<a href="${safe.link}">${safe.link}</a>` : "Not provided"}</p>
    <h2>${safe.topic}</h2>
    <p>${safe.message.replace(/\n/g, "<br>")}</p>
    </div>
  `;
  const confirmationText = [
    `Hi ${submission.name},`,
    "",
    "Broadway Pixels received your message.",
    `Ticket number: ${ticketId}`,
    `Project: ${submission.project}`,
    `Subject: ${submission.topic}`,
    "",
    "Keep this number for your records. You can reply to this email if you need to add anything.",
  ].join("\n");
  const confirmationHtml = `
    <div style="font-family:Arial,sans-serif;color:#10224a;line-height:1.6;max-width:620px;margin:auto">
      <img src="${logoUrl}" alt="Broadway Pixels" width="190" style="display:block;width:190px;max-width:45%;height:auto;margin:0 0 24px">
      <p style="color:#1557d6;font-weight:700;margin:0">Ticket ${safeTicketId}</p>
      <h1 style="margin:4px 0 18px">We received your message.</h1>
      <p>Hi ${safe.name},</p>
      <p>Thanks for contacting Broadway Pixels. Your request has been added to the support queue.</p>
      <div style="background:#eef4ff;border:1px solid #bfd3f7;border-radius:12px;padding:18px 20px;margin:24px 0">
        <p style="margin:0 0 6px"><strong>Project:</strong> ${safe.project}</p>
        <p style="margin:0"><strong>Subject:</strong> ${safe.topic}</p>
      </div>
      <p>Keep <strong>${safeTicketId}</strong> for your records. Reply to this email if you need to add anything.</p>
    </div>
  `;

  try {
    const admin = await postResendEmail({
      from: env.SUPPORT_FROM_EMAIL,
      to: [to],
      reply_to: submission.email,
      subject: `[${ticketId}] [${submission.project}] ${subjectTopic}`,
      html: adminHtml,
      text: adminText,
      tags: [{ name: "project", value: projectTag }, { name: "type", value: "support_ticket" }],
    }, `support-admin-${submission.requestId}`, env, fetchImpl);
    if (!admin.ok) return { ok: false, status: 502, message: "Email service is temporarily unavailable." };

    let confirmation;
    try {
      confirmation = await postResendEmail({
        from: env.SUPPORT_FROM_EMAIL,
        to: [submission.email],
        reply_to: to,
        subject: `Broadway Pixels received your request - ${ticketId}`,
        html: confirmationHtml,
        text: confirmationText,
        tags: [{ name: "project", value: projectTag }, { name: "type", value: "support_confirmation" }],
      }, `support-confirmation-${submission.requestId}`, env, fetchImpl);
    } catch (error) {
      console.error(`Support confirmation failed for ${ticketId}`, error);
      return { ok: true, status: 200, id: admin.id, confirmationSent: false };
    }

    if (!confirmation.ok) {
      console.error(`Support confirmation failed for ${ticketId}`);
      return { ok: true, status: 200, id: admin.id, confirmationSent: false };
    }

    return {
      ok: true,
      status: 200,
      id: admin.id,
      confirmationId: confirmation.id,
      confirmationSent: true,
    };
  } catch (error) {
    console.error("Resend request failed", error);
    return { ok: false, status: 502, message: "Email service is temporarily unavailable." };
  }
}
