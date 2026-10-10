import { env, type EmailProvider } from "../env.js";

/*
  Email delivery via Brevo's HTTP API.

  History, for the next person who touches this file: every previous
  version of this file used Nodemailer over raw SMTP (ports 465/587)
  to Gmail. That worked perfectly from a local machine but reliably
  timed out (`ETIMEDOUT`, `command: 'CONN'`) when running on Render —
  even after ruling out every configuration issue along the way (wrong
  IP family, wrong Nodemailer version, wrong port). The conclusion,
  confirmed by the local/Render split (identical code, identical
  credentials, only the network differs): Render blocks outbound SMTP
  ports from its containers. This is a known restriction on several
  free-tier PaaS platforms, to stop their shared IP ranges from being
  used to relay spam — no amount of client-side configuration can get
  a raw SMTP connection through it.

  The fix is to stop using SMTP entirely. Brevo's API sends email over
  a normal HTTPS POST request (port 443) — indistinguishable from any
  other outbound API call your app already makes, so it isn't affected
  by SMTP-specific port blocking. Free tier: 300 emails/day, and unlike
  Resend's default sender, Brevo's single-sender verification lets you
  verify one email address you already own (e.g. your Gmail) by
  clicking a confirmation link — no domain or DNS records required —
  and then send to any recipient, not just yourself.

  Setup (one-time, in the Brevo dashboard):
    1. Sign up at brevo.com (free).
    2. Settings → Senders, Domains & Dedicated IPs → add your email as
       a sender → click the verification link Brevo emails you.
    3. Settings → SMTP & API → API Keys → generate a new key.
    4. Set on Render: BREVO_API_KEY=<that key>, and make sure
       SMTP_FROM matches the exact address you verified as a sender.
*/

interface SendEmailOpts {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Parses "Name <email@example.com>" or a bare "email@example.com" into
 *  Brevo's { name, email } sender shape. */
function parseSender(from: string): { name?: string; email: string } {
  const match = from.match(/^(.*)<(.+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
  }
  return { email: from.trim() };
}

export interface SendResult {
  ok: boolean;
  provider: EmailProvider;
  /** Human-readable reason when ok is false (also logged). */
  error?: string;
}

/**
 * Send a transactional email through the configured provider (see env.email):
 *   - "brevo"   : Brevo's HTTP API — production, unchanged
 *   - "smtp"    : plain SMTP to Mailpit (localhost:1025) — local development
 *   - "both"    : Mailpit copy + real delivery through Brevo (local development
 *                 when you also want mail to reach real inboxes, e.g. Mailinator)
 *   - "console" : print the email to the server log
 * Never throws — a failed email should never break the request that triggered
 * it (signup, invite, password reset). The result says what happened, and
 * every failure is logged with the provider and a plain-language cause.
 */
export async function sendEmail(opts: SendEmailOpts): Promise<SendResult> {
  const provider = env.email.provider;
  if (provider === "smtp") return sendViaSmtp(opts);
  if (provider === "brevo") return sendViaBrevo(opts);
  if (provider === "both") return sendViaBoth(opts);
  console.log(
    `\n[email:console] to=${opts.to} subject="${opts.subject}"\n${opts.text}\n`,
  );
  return { ok: true, provider: "console" };
}

function fail(provider: EmailProvider, to: string, error: string): SendResult {
  console.error(`[email:${provider}] could not send to ${to}: ${error}`);
  return { ok: false, provider, error };
}

// ---- Local development: Mailpit (or any plain SMTP catcher) ----------------

// nodemailer is loaded lazily so production (Brevo over HTTPS) never touches it.
let smtpTransport: any;
async function getSmtpTransport() {
  if (!smtpTransport) {
    const nodemailer: any = (await import("nodemailer")).default;
    smtpTransport = nodemailer.createTransport({
      host: env.email.smtp.host,
      port: env.email.smtp.port,
      secure: false, // Mailpit speaks plain SMTP; no auth, no TLS
      ignoreTLS: true,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
  }
  return smtpTransport;
}

function smtpErrorMessage(err: any): string {
  const where = `${env.email.smtp.host}:${env.email.smtp.port}`;
  const code = err?.code as string | undefined;
  if (code === "ECONNREFUSED" || code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") {
    return `SMTP server not reachable at ${where} (${code}). Is Mailpit running? Try: docker compose up -d mailpit`;
  }
  return `SMTP error at ${where}: ${err?.message ?? String(err)}`;
}

async function sendViaSmtp(opts: SendEmailOpts): Promise<SendResult> {
  try {
    const sender = parseSender(env.email.from);
    const transport = await getSmtpTransport();
    const info = await transport.sendMail({
      from: sender.name ? { name: sender.name, address: sender.email } : sender.email,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    console.log(`[email:smtp] sent to ${opts.to} via ${env.email.smtp.host}:${env.email.smtp.port} (${info?.messageId ?? "no id"}) — view at http://localhost:8025`);
    return { ok: true, provider: "smtp" };
  } catch (err) {
    return fail("smtp", opts.to, smtpErrorMessage(err));
  }
}

// ---- Both: Mailpit copy + real delivery ------------------------------------

// Reserved/non-routable TLDs (RFC 2606/6761): a real mail provider can never
// deliver to them, so don't spend Brevo quota or create bounces on them.
const UNDELIVERABLE_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);
const isUndeliverable = (addr: string) => UNDELIVERABLE_TLDS.has(addr.split("@").pop()!.split(".").pop()!.toLowerCase());

async function sendViaBoth(opts: SendEmailOpts): Promise<SendResult> {
  const skipBrevo = isUndeliverable(opts.to);
  const [local, real] = await Promise.all([
    sendViaSmtp(opts),
    skipBrevo ? Promise.resolve(null) : sendViaBrevo(opts),
  ]);
  if (skipBrevo) {
    console.log(`[email:both] ${opts.to} is a reserved test address — delivered to Mailpit only (Brevo skipped).`);
  }
  const errors = [local, real].filter((r): r is SendResult => !!r && !r.ok).map((r) => `${r.provider}: ${r.error}`);
  return errors.length
    ? { ok: false, provider: "both", error: errors.join(" | ") }
    : { ok: true, provider: "both" };
}

// ---- Production: Brevo HTTP API (unchanged behaviour) -----------------------

async function sendViaBrevo(opts: SendEmailOpts): Promise<SendResult> {
  if (!env.email.brevoApiKey) {
    return fail("brevo", opts.to, "BREVO_API_KEY is not set. Set it, or choose EMAIL_PROVIDER=smtp (Mailpit) / console for local use.");
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": env.email.brevoApiKey,
      },
      body: JSON.stringify({
        sender: parseSender(env.email.from),
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
        textContent: opts.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fail("brevo", opts.to, `Brevo rejected the request: ${res.status} ${res.statusText} — ${body}`);
    }

    const data = (await res.json()) as { messageId?: string };
    console.log("[email] sent:", data.messageId, "to", opts.to);
    return { ok: true, provider: "brevo" };
  } catch (err) {
    return fail("brevo", opts.to, `Could not reach Brevo: ${(err as Error)?.message ?? String(err)}`);
  }
}

const BRAND_BG = "#2c1810";
const BRAND_TEXT = "#ffffff";
const PRIMARY = "#92613a";
const PRIMARY_HOVER = "#7a5030";
const BODY_BG = "#f5f0ea";
const CARD_BG = "#ffffff";
const TEXT_DARK = "#2c1810";
const TEXT_MID = "#5c4436";
const TEXT_MUTED = "#a08b7a";
const BORDER = "#e8ded2";

function emailShell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tickets</title>
</head>
<body style="margin:0;padding:0;background:${BODY_BG};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT_DARK};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BODY_BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:${BRAND_BG};padding:28px 32px;border-radius:16px 16px 0 0;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="background:${PRIMARY};width:36px;height:36px;border-radius:10px;text-align:center;vertical-align:middle;font-weight:800;font-size:18px;color:#fff;">T</td>
                  <td style="padding-left:12px;">
                    <div style="font-size:18px;font-weight:700;color:${BRAND_TEXT};line-height:1.2;">Tickets</div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:0.08em;text-transform:uppercase;">Ticket Management</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body card -->
          <tr>
            <td style="background:${CARD_BG};padding:36px 32px 28px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${CARD_BG};padding:20px 32px 28px;border-top:1px solid ${BORDER};border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};border-radius:0 0 16px 16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:12px;border-top:1px solid ${BORDER};padding-top:20px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:${TEXT_DARK};">Tickets — Ticket Management</p>
                    <p style="margin:0 0 4px;font-size:12px;color:${TEXT_MUTED};">Built by your team · <a href="mailto:support@example.com" style="color:${PRIMARY};text-decoration:none;">Contact support</a></p>
                  </td>
                </tr>
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:${TEXT_MUTED};line-height:1.5;">You received this email because you have an account on Tickets. If you didn't expect this, you can safely ignore it.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td style="background:${PRIMARY};border-radius:10px;text-align:center;">
      <a href="${url}" target="_blank" style="display:inline-block;padding:13px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.02em;">
        ${text}
      </a>
    </td>
  </tr>
</table>`;
}

function otpBlock(code: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td style="background:${BODY_BG};border:2px solid ${BORDER};border-radius:12px;padding:16px 36px;text-align:center;">
      <span style="font-size:36px;font-weight:800;letter-spacing:12px;color:${TEXT_DARK};font-family:'Courier New',Courier,monospace;">${code}</span>
    </td>
  </tr>
</table>`;
}

/* ─────────────────────────────────────────────────────────
   Email templates
   ───────────────────────────────────────────────────────── */

export function signupOtpEmail(name: string, code: string): SendEmailOpts {
  const text = `Hi ${name},\n\nYour Tickets verification code is:\n\n${code}\n\nEnter it to finish creating your organisation. The code expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`;

  const html = emailShell(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_DARK};">Verify your email</h2>
    <p style="margin:0 0 24px;font-size:15px;color:${TEXT_MID};line-height:1.6;">Hi <strong>${name}</strong>, use the code below to verify your email. It expires in <strong>15 minutes</strong>.</p>
    ${otpBlock(code)}
    <p style="margin:24px 0 0;font-size:13px;color:${TEXT_MUTED};text-align:center;">If you didn't request this, you can safely ignore this email.</p>
  `);

  return { to: "", subject: "Your Tickets verification code", html, text };
}

export function inviteEmail(opts: {
  orgName: string;
  inviterName: string;
  role: string;
  projectNames: string[];
  inviteUrl: string;
}): SendEmailOpts {
  const roleLabel = opts.role.toLowerCase();
  const projectLine =
    opts.projectNames.length > 0 ? ` on ${opts.projectNames.join(", ")}` : "";

  const text = `Hi,\n\n${opts.inviterName} invited you to join ${opts.orgName} on Tickets as ${roleLabel}${projectLine}.\n\nUse this link to set up your account (or sign in if you already have one):\n\n${opts.inviteUrl}\n\nThe invite expires in 14 days. If you weren't expecting this, you can ignore this email.`;

  const html = emailShell(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_DARK};">You're invited! 🎉</h2>
    <p style="margin:0 0 20px;font-size:15px;color:${TEXT_MID};line-height:1.6;">
      <strong>${opts.inviterName}</strong> invited you to join <strong>${opts.orgName}</strong> on Tickets as <strong>${roleLabel}</strong>${projectLine}.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:${BODY_BG};border-radius:10px;padding:0;">
      <tr>
        <td style="padding:16px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-bottom:6px;font-size:12px;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Organisation</td>
            </tr>
            <tr>
              <td style="font-size:15px;font-weight:600;color:${TEXT_DARK};">${opts.orgName}</td>
            </tr>
          </table>
        </td>
        <td style="padding:16px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-bottom:6px;font-size:12px;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Your role</td>
            </tr>
            <tr>
              <td style="font-size:15px;font-weight:600;color:${PRIMARY};">${roleLabel}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${ctaButton("Accept invitation", opts.inviteUrl)}
    <p style="margin:20px 0 0;font-size:12px;color:${TEXT_MUTED};text-align:center;line-height:1.5;">This invite expires in 14 days. If you weren't expecting this, you can safely ignore it.</p>
    <p style="margin:12px 0 0;font-size:11px;color:${TEXT_MUTED};text-align:center;word-break:break-all;">${opts.inviteUrl}</p>
  `);

  return { to: "", subject: `You've been invited to ${opts.orgName} on Tickets`, html, text };
}

export function passwordResetEmail(name: string, resetUrl: string): SendEmailOpts {
  const text = `Hi ${name},\n\nWe received a request to reset your Tickets password. Use the link below to choose a new one. This link expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`;

  const html = emailShell(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_DARK};">Reset your password</h2>
    <p style="margin:0 0 24px;font-size:15px;color:${TEXT_MID};line-height:1.6;">Hi <strong>${name}</strong>, we received a request to reset your Tickets password. Click below to choose a new one.</p>
    ${ctaButton("Choose a new password", resetUrl)}
    <p style="margin:24px 0 0;font-size:13px;color:${TEXT_MUTED};text-align:center;">This link expires in <strong>1 hour</strong>. If you didn't request it, ignore this email — your password won't change.</p>
    <p style="margin:12px 0 0;font-size:11px;color:${TEXT_MUTED};text-align:center;word-break:break-all;">${resetUrl}</p>
  `);

  return { to: "", subject: "Reset your Tickets password", html, text };
}

export function pinResetEmail(name: string, resetUrl: string): SendEmailOpts {
  const text = `Hi ${name},\n\nWe received a request to reset your Tickets 2FA PIN. Use the link below to set a new one. This link expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your PIN won't change.`;

  const html = emailShell(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_DARK};">Reset your 2FA PIN</h2>
    <p style="margin:0 0 24px;font-size:15px;color:${TEXT_MID};line-height:1.6;">Hi <strong>${name}</strong>, we received a request to reset your Tickets two-factor PIN. Click below to choose a new one.</p>
    ${ctaButton("Choose a new PIN", resetUrl)}
    <p style="margin:24px 0 0;font-size:13px;color:${TEXT_MUTED};text-align:center;">This link expires in <strong>1 hour</strong>. If you didn't request it, ignore this email — your PIN won't change.</p>
    <p style="margin:12px 0 0;font-size:11px;color:${TEXT_MUTED};text-align:center;word-break:break-all;">${resetUrl}</p>
  `);

  return { to: "", subject: "Reset your Tickets 2FA PIN", html, text };
}

export function passwordChangedEmail(name: string): SendEmailOpts {
  const text = `Hi ${name},\n\nYour Tickets password was just changed. If this was you, no action is needed.\n\nIf you didn't make this change, please reset your password immediately or contact support.`;

  const html = emailShell(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_DARK};">Password changed</h2>
    <p style="margin:0 0 20px;font-size:15px;color:${TEXT_MID};line-height:1.6;">Hi <strong>${name}</strong>, your Tickets password was just changed successfully.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:${BODY_BG};border-radius:10px;padding:16px 20px;">
          <p style="margin:0;font-size:14px;color:${TEXT_MID};line-height:1.6;">
            ✅ &nbsp;If this was you, no action is needed.<br/>
            ⚠️ &nbsp;If you didn't make this change, <a href="mailto:support@example.com" style="color:${PRIMARY};font-weight:600;text-decoration:none;">contact support</a> immediately.
          </p>
        </td>
      </tr>
    </table>
  `);

  return { to: "", subject: "Your Tickets password was changed", html, text };
}

export function welcomeEmail(name: string, loginUrl: string): SendEmailOpts {
  const text = `Welcome to Tickets, ${name}!\n\nYour account is set up and your organisation is ready. Sign in to start creating projects and managing tickets.\n\n${loginUrl}\n\nWelcome aboard!`;

  const html = emailShell(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_DARK};">Welcome to Tickets! 🎉</h2>
    <p style="margin:0 0 20px;font-size:15px;color:${TEXT_MID};line-height:1.6;">Hi <strong>${name}</strong>, your account is set up and your organisation is ready to go.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:${BODY_BG};border-radius:10px;padding:16px 20px;">
          <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:${TEXT_DARK};">Here's what you can do:</p>
          <p style="margin:0;font-size:14px;color:${TEXT_MID};line-height:1.8;">
            📁 &nbsp;Create projects to organise your work<br/>
            🎫 &nbsp;Create and assign tickets to your team<br/>
            👥 &nbsp;Invite team members with different roles<br/>
            🔔 &nbsp;Get Telegram notifications for updates
          </p>
        </td>
      </tr>
    </table>
    ${ctaButton("Go to your dashboard", loginUrl)}
  `);

  return { to: "", subject: "Welcome to Tickets!", html, text };
}

export function orgCreationVerifyEmail(name: string, orgName: string, verifyUrl: string): SendEmailOpts {
  const text = `Hi ${name},\n\nSomeone (hopefully you) requested to create a new organisation called "${orgName}" on Tickets. If this was you, click the link below to confirm and finish creating it. This link expires in 30 minutes.\n\n${verifyUrl}\n\nIf you didn't request this, ignore this email — no organisation will be created.`;

  const html = emailShell(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_DARK};">Confirm it's you</h2>
    <p style="margin:0 0 24px;font-size:15px;color:${TEXT_MID};line-height:1.6;">Hi <strong>${name}</strong>, someone requested to create a new organisation called <strong>${orgName}</strong>. Click below to confirm and finish creating it.</p>
    ${ctaButton("Confirm & create organisation", verifyUrl)}
    <p style="margin:24px 0 0;font-size:13px;color:${TEXT_MUTED};text-align:center;">This link expires in <strong>30 minutes</strong>. If you didn't request this, ignore this email — nothing will be created.</p>
    <p style="margin:12px 0 0;font-size:11px;color:${TEXT_MUTED};text-align:center;word-break:break-all;">${verifyUrl}</p>
  `);

  return { to: "", subject: `Confirm: create "${orgName}" on Tickets`, html, text };
}