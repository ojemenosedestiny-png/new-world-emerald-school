// Transactional email through Resend's HTTP API (no SDK). Configure RESEND_API_KEY and EMAIL_FROM.

export type EmailResult = { sent: boolean; reason?: "not_configured" | "rejected" | "unreachable"; detail?: string };

export const emailConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());

const ADDRESS = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
export const EMAIL_FROM_HELP = "EMAIL_FROM has the wrong format. In Render use noreply@yourdomain.com or New World Emerald <noreply@yourdomain.com>";

/**
 * The sender Resend expects ("a@b.com" or "Name <a@b.com>"), forgiving the usual
 * paste mistakes: a copied "EMAIL_FROM=" prefix, surrounding quotes, or a name with
 * no angle brackets. Null when it still is not an address.
 */
export function emailSender(raw: string | undefined): string | null {
  let value = (raw ?? "").trim().replace(/^EMAIL_FROM\s*=\s*/i, "").trim();
  const quoted = /^(["'])(.*)\1$/s.exec(value);
  if (quoted) value = quoted[2].trim();
  value = value.replace(/\s+/g, " ");
  if (ADDRESS.test(value)) return value;
  const named = /^(.*?)\s*<\s*([^<>\s]+)\s*>$/.exec(value);
  if (named && ADDRESS.test(named[2])) return named[1].replace(/["']/g, "").trim() ? `${named[1].replace(/["']/g, "").trim()} <${named[2]}>` : named[2];
  const trailing = /^(.+?)\s+([^\s<>]+)$/.exec(value);
  if (trailing && ADDRESS.test(trailing[2]) && !trailing[1].includes("@")) return `${trailing[1].replace(/["']/g, "").trim()} <${trailing[2]}>`;
  return null;
}

export async function sendEmail(message: { to: string; subject: string; html: string; text: string }, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<EmailResult> {
  if (!emailConfigured(env)) return { sent: false, reason: "not_configured" };
  const from = emailSender(env.EMAIL_FROM);
  if (!from) return { sent: false, reason: "not_configured", detail: EMAIL_FROM_HELP };
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { sent: true };
    // Resend explains failures (unverified domain, test-sender restrictions) in its JSON body.
    let detail = `HTTP ${response.status}`;
    try { const body = await response.json() as { message?: string }; if (body?.message) detail = body.message.slice(0, 200); } catch { /* not JSON */ }
    return { sent: false, reason: "rejected", detail };
  } catch (error) {
    return { sent: false, reason: "unreachable", detail: error instanceof Error ? error.message.slice(0, 200) : "network error" };
  }
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, bodyHtml: string, cta: { label: string; url: string }, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Segoe UI,Arial,sans-serif;color:#10232c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3ded2">
  <tr><td style="background:#10232c;padding:20px 28px;border-bottom:3px solid #d9a524"><p style="margin:0;color:#f7f4ec;font:700 18px Georgia,serif">New World Emerald Private School</p><p style="margin:4px 0 0;color:#d9a524;font:600 11px Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase">Student portal</p></td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 12px;font:600 22px Georgia,serif">${esc(title)}</h1>
    ${bodyHtml}
    <p style="margin:24px 0"><a href="${esc(cta.url)}" style="display:inline-block;background:#176345;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(cta.label)}</a></p>
    <p style="margin:0;font-size:12px;color:#5c6b70">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(cta.url)}</span></p>
    <p style="margin:20px 0 0;font-size:12px;color:#5c6b70">${esc(footer)}</p>
  </td></tr></table></td></tr></table></body></html>`;
}

export function activationEmail(p: { studentName: string; studentId: string; className: string; url: string; hours: number }) {
  const subject = `Activate ${p.studentName}'s student portal account`;
  const html = layout("Activate the student portal account", `
    <p style="margin:0 0 10px;line-height:1.6">${esc(p.studentName)} (${esc(p.className)}) has been enrolled on the New World Emerald student portal.</p>
    <p style="margin:0 0 10px;line-height:1.6">Student ID: <b style="font-family:Consolas,monospace">${esc(p.studentId)}</b></p>
    <p style="margin:0;line-height:1.6">Open the link below with your child to confirm their details and choose a private password. They will then sign in with their Student ID and that password.</p>`,
    { label: "Activate account", url: p.url },
    `This link works once and expires in ${p.hours} hours. If it expires, ask the school office for a new one. If you were not expecting this email, you can ignore it.`);
  const text = `${p.studentName} (${p.className}) has been enrolled on the New World Emerald student portal.\nStudent ID: ${p.studentId}\n\nActivate the account and choose a password:\n${p.url}\n\nThis link works once and expires in ${p.hours} hours.`;
  return { subject, html, text };
}

export function resetEmail(p: { studentName: string; studentId: string; url: string; hours: number }) {
  const subject = `Reset ${p.studentName}'s student portal password`;
  const html = layout("Reset the portal password", `
    <p style="margin:0 0 10px;line-height:1.6">A password reset was requested for ${esc(p.studentName)} (Student ID <b style="font-family:Consolas,monospace">${esc(p.studentId)}</b>).</p>
    <p style="margin:0;line-height:1.6">Open the link below to choose a new password. Any devices still signed in will be signed out.</p>`,
    { label: "Choose a new password", url: p.url },
    `This link works once and expires in ${p.hours} hours. If you did not ask for this, ignore this email; the current password keeps working.`);
  const text = `A password reset was requested for ${p.studentName} (Student ID ${p.studentId}).\n\nChoose a new password:\n${p.url}\n\nThis link works once and expires in ${p.hours} hours. If you did not ask for this, ignore this email.`;
  return { subject, html, text };
}
