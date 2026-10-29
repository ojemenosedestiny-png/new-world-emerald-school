// Transactional email through Resend's HTTP API (no SDK). Configure RESEND_API_KEY and EMAIL_FROM.

export type EmailResult = { sent: boolean; reason?: "not_configured" | "rejected" | "unreachable"; detail?: string };

export const emailConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());

const ADDRESS = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
export const EMAIL_FROM_HELP = "EMAIL_FROM has the wrong format. In Render use noreply@yourdomain.com or New World Emerald <noreply@yourdomain.com>";

/**
 * The sender Resend expects ("a@b.com" or "Name <a@b.com>"), forgiving the usual
 * paste mistakes: a copied "EMAIL_FROM=" prefix, surrounding quotes, a name with
 * no angle brackets, or only the domain. Null when it still is not an address.
 */
export function emailSender(raw: string | undefined): string | null {
  let value = (raw ?? "").trim().replace(/^EMAIL_FROM\s*=\s*/i, "").trim();
  const quoted = /^(["'])(.*)\1$/s.exec(value);
  if (quoted) value = quoted[2].trim();
  value = value.replace(/\s+/g, " ");
  if (ADDRESS.test(value)) return value;
  // Just the domain (e.g. "school.com"): send from noreply@ on it under the school's name.
  if (/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(value)) return `New World Emerald <noreply@${value.toLowerCase()}>`;
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

/** Sent once the student has chosen a password: their sign-in details (never the password). */
export function accountReadyEmail(p: { studentName: string; studentId: string; className: string; signInUrl: string }) {
  const subject = `${p.studentName}'s student portal account is ready`;
  const html = layout("The student portal account is ready", `
    <p style="margin:0 0 10px;line-height:1.6">${esc(p.studentName)} (${esc(p.className)}) has created a password and can now use the New World Emerald student portal.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 12px;background:#f4f1ea;border-radius:10px"><tr><td style="padding:12px 16px;line-height:1.7">
      <span style="color:#5c6b70;font-size:12px">Sign-in details</span><br>
      Student ID: <b style="font-family:Consolas,monospace">${esc(p.studentId)}</b><br>
      Password: the one ${esc(p.studentName)} just chose
    </td></tr></table>
    <p style="margin:0;line-height:1.6">Keep the password private. If it is forgotten, use "Forgot password" on the sign-in page and a reset link will come to this email address.</p>`,
    { label: "Sign in to the portal", url: p.signInUrl },
    "If you did not create this account, contact the school office.");
  const text = `${p.studentName} (${p.className}) can now use the New World Emerald student portal.

Sign in: ${p.signInUrl}
Student ID: ${p.studentId}
Password: the one ${p.studentName} just chose

If the password is forgotten, use "Forgot password" on the sign-in page.`;
  return { subject, html, text };
}

/** Security notice after a password reset, so the family notices a change they did not make. */
export function passwordChangedEmail(p: { studentName: string; studentId: string; signInUrl: string }) {
  const subject = `${p.studentName}'s portal password was changed`;
  const html = layout("The portal password was changed", `
    <p style="margin:0 0 10px;line-height:1.6">The password for ${esc(p.studentName)} (Student ID <b style="font-family:Consolas,monospace">${esc(p.studentId)}</b>) was just changed, and other devices were signed out.</p>
    <p style="margin:0;line-height:1.6">If this was you, nothing else is needed.</p>`,
    { label: "Sign in to the portal", url: p.signInUrl },
    "If you did not change the password, contact the school office straight away.");
  const text = `The password for ${p.studentName} (Student ID ${p.studentId}) was just changed and other devices were signed out.
Sign in: ${p.signInUrl}

If you did not change it, contact the school office straight away.`;
  return { subject, html, text };
}


/** Tells a newly approved teacher how to sign in; staff sign in with a one-time email code, so there is no password. */
export function teacherInviteEmail(p: { teacherName: string; email: string; classNames: string[]; signInUrl: string }) {
  const classes = p.classNames.length ? p.classNames.join(", ") : "none yet (the school office will assign them)";
  const subject = "You have been added as a teacher at New World Emerald";
  const html = layout("Welcome to the teacher portal", `
    <p style="margin:0 0 10px;line-height:1.6">Dear ${esc(p.teacherName)},</p>
    <p style="margin:0 0 10px;line-height:1.6">The school office has given you access to the New World Emerald teacher portal, where you take the register, set assignments and CBT exams, mark work, prepare report cards and answer messages from your students.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 12px;background:#f4f1ea;border-radius:10px"><tr><td style="padding:12px 16px;line-height:1.7">
      <span style="color:#5c6b70;font-size:12px">Your access</span><br>
      Sign in with: <b>${esc(p.email)}</b><br>
      Your classes: <b>${esc(classes)}</b>
    </td></tr></table>
    <p style="margin:0 0 6px;line-height:1.6"><b>How to sign in</b></p>
    <ol style="margin:0 0 4px;padding-left:20px;line-height:1.7">
      <li>Open the link below (bookmark it for next time).</li>
      <li>Enter this email address.</li>
      <li>Type the six-digit code we email you. There is no password to remember.</li>
    </ol>`,
    { label: "Open the teacher portal", url: p.signInUrl },
    "Never share your sign-in code. If you were not expecting this email, contact the school office.");
  const text = `Dear ${p.teacherName},

The school office has given you access to the New World Emerald teacher portal.

Sign in with: ${p.email}
Your classes: ${classes}

How to sign in:
1. Open ${p.signInUrl} (bookmark it for next time).
2. Enter this email address.
3. Type the six-digit code we email you. There is no password.

Never share your sign-in code.`;
  return { subject, html, text };
}

/** The Director's weekly report: the highlights first, then the figures, with a link to the full dashboard. */
export function directorReportEmail(r: import("./director").DirectorReport, dashboardUrl: string) {
  const ng = (kobo: number) => `NGN ${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  const period = `${day(r.from)} to ${day(r.to)}`;
  const rows: [string, string][] = [
    ["Admissions", `${r.admissions.newThisWeek} new, ${r.admissions.awaitingReview} waiting for review`],
    ["Students", `${r.students.active} active, ${r.students.pendingActivation} accounts not yet activated`],
    ["Attendance", r.attendance.rate === null ? "No registers taken" : `${r.attendance.rate}% (${r.attendance.absentToday} absent today)`],
    ["Exams and homework", `${r.learning.attemptsSubmitted} exam papers submitted${r.learning.averageScore === null ? "" : `, average ${r.learning.averageScore}%`}; ${r.learning.assignmentsSet} assignments set, ${r.learning.submissions} handed in`],
    ["Fees", `${ng(r.money.confirmedKobo)} confirmed; ${r.money.awaitingCount} payments (${ng(r.money.awaitingKobo)}) awaiting confirmation`],
    ["Store", `${r.money.storeOrders} orders (${ng(r.money.storeOrdersKobo)})`],
    ["Messages", `${r.messages.thisWeek} this week, ${r.messages.unanswered} waiting for a staff reply`],
    ["Teachers", `${r.staff.activeTeachers} active`],
    ["Website", `${r.website.liveUpdates} live updates posted`],
  ];
  const subject = `Weekly school report: ${period}`;
  const html = layout("Your weekly school report", `
    <p style="margin:0 0 10px;line-height:1.6;color:#5c6b70">${esc(period)}</p>
    ${r.highlights.length ? `<p style="margin:0 0 6px;font-weight:700">Needs your attention</p><ul style="margin:0 0 14px;padding-left:20px;line-height:1.7">${r.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:14px">
      ${rows.map(([k, v]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e6e1d6;font-weight:700;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:8px 10px;border-bottom:1px solid #e6e1d6">${esc(v)}</td></tr>`).join("")}
    </table>`,
    { label: "Open the Director dashboard", url: dashboardUrl },
    "This report is sent only to the Director. To stop it, ask your developer to remove your email from SCHOOL_DIRECTOR_EMAILS.");
  const text = [`Weekly school report: ${period}`, "", ...(r.highlights.length ? ["Needs your attention:", ...r.highlights.map((h) => `- ${h}`), ""] : []),
    ...rows.map(([k, v]) => `${k}: ${v}`), "", `Dashboard: ${dashboardUrl}`].join("\n");
  return { subject, html, text };
}

/** A message from the Director to staff. The text is escaped; blank lines start new paragraphs. */
export function staffBroadcastEmail(p: { subject: string; message: string; senderName: string; portalUrl: string }) {
  const paragraphs = p.message.trim().split(/\n\s*\n/).map((para) => `<p style="margin:0 0 12px;line-height:1.65">${esc(para.trim()).replace(/\n/g, "<br>")}</p>`).join("");
  const html = layout(p.subject, `${paragraphs}<p style="margin:16px 0 0;line-height:1.6">${esc(p.senderName)}<br><span style="color:#5c6b70">Director, New World Emerald Private School</span></p>`,
    { label: "Open the staff portal", url: p.portalUrl },
    "You receive this because you are a member of staff at New World Emerald Private School.");
  const text = `${p.message.trim()}\n\n${p.senderName}\nDirector, New World Emerald Private School\n\nStaff portal: ${p.portalUrl}`;
  return { subject: p.subject, html, text };
}
