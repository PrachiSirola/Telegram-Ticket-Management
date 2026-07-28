import nodemailer from "nodemailer";
import { env } from "../env.js";

console.log({
  host: env.email.host,
  port: env.email.port,
  user: env.email.user,
  from: env.email.from,
  passLength: env.email.pass.length,
});
const smtp = 
  env.email.user && env.email.pass
    ? nodemailer.createTransport({
        host: "192.178.211.109",
        port: 587,
        secure: false,
        auth: {
          user: env.email.user,
          pass: env.email.pass,
        },
        tls: {
          servername: "smtp.gmail.com",
        },
      })
    : null;
smtp?.verify((err: Error | null, success: boolean) => {
  if (err) {
    console.error("SMTP VERIFY ERROR:", err);
  } else {
    console.log("SMTP VERIFIED");
  }
});
interface SendEmailOpts {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(opts: SendEmailOpts) {
  try {
    if (smtp) {
      console.log("Sending email to:", opts.to);
      const info = await smtp.sendMail({
        from: env.email.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      console.log("Email sent successfully:", info.messageId);
      return;
    }
    console.log(
      `\n[email:console] to=${opts.to} subject="${opts.subject}"\n${opts.text}\n`,
    );
  } catch (err) {
    console.error("[email] send error:", err);
  }
}

/* ─────────────────────────────────────────────────────────
   Shared layout helpers — dark brown header, warm card,
   professional footer. All inline CSS for email clients.
   ───────────────────────────────────────────────────────── */

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