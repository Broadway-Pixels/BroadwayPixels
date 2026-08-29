const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export function verificationMessage({ to, verificationUrl, from = 'noreply@fleeterbase.com' }) {
  const safeUrl = escapeHtml(verificationUrl);
  return {
    to,
    from: { email: from, name: 'Fleeterbase' },
    replyTo: 'support@broadwaypixels.com',
    subject: 'Verify your Fleeterbase account',
    text: `Verify your Fleeterbase account by opening this link:\n\n${verificationUrl}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Arial,sans-serif;color:#0a1d35"><div style="max-width:560px;margin:32px auto;background:#fff;border:1px solid #dce4e9;border-radius:10px;padding:36px"><h1 style="margin:0 0 14px;font-size:28px">Verify your Fleeterbase account</h1><p style="color:#526477;line-height:1.6">Confirm your email address to finish creating your rental fleet workspace.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#08756f;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:6px">Verify email address</a></p><p style="color:#6b7c8c;font-size:13px;line-height:1.6">This link expires in 24 hours. If you did not create this account, you can ignore this email.</p></div></body></html>`,
  };
}

export async function sendVerificationEmail(relay, relaySecret, options) {
  if (!relay || !relaySecret) throw new Error('Email sending is not configured.');
  const response = await relay.fetch('https://broadwaypixels.internal/api/internal/fleeterbase-verification', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fleeterbase-relay-secret': relaySecret },
    body: JSON.stringify({ to: options.to, verificationUrl: options.verificationUrl }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || 'Verification email could not be delivered.');
  return result;
}
