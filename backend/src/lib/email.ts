import { Resend } from "resend";
import nodemailer from "nodemailer";
import { env } from "../env.js";

// Driver precedence: local SMTP (Mailpit) → Resend → console log.
const smtp = env.email.smtpUrl ? nodemailer.createTransport(env.email.smtpUrl) : null;
const resend = !smtp && env.email.resendApiKey ? new Resend(env.email.resendApiKey) : null;

interface SendEmailOpts {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send a transactional email. In local dev, set SMTP_URL=smtp://localhost:1025
 * and every email lands in the Mailpit inbox (http://localhost:8025) — any
 * recipient address, nothing leaves your machine. With RESEND_API_KEY set
 * (and no SMTP_URL), sends via Resend. With neither, logs to the console.
 * Never throws.
 */
export async function sendEmail(opts: SendEmailOpts) {
  try {
    if (smtp) {
      await smtp.sendMail({
        from: env.email.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      return;
    }
    if (resend) {
      const { error } = await resend.emails.send({
        from: env.email.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      if (error) console.error("[email] send failed:", error);
      return;
    }
    console.log(
      `\n[email:console] to=${opts.to} subject="${opts.subject}"\n${opts.text}\n`,
    );
  } catch (err) {
    console.error("[email] send error:", err);
  }
}

export function signupOtpEmail(name: string, code: string): SendEmailOpts {
  const text = `Hi ${name},

Your Tickets verification code is:

${code}

Enter it to finish creating your organisation. The code expires in 15 minutes.

If you didn't request this, you can safely ignore this email.`;

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0f172a;">
    <h2 style="margin: 0 0 12px;">Verify your email</h2>
    <p style="margin: 0 0 16px; color: #475569;">Hi ${name}, enter this code to finish creating your organisation:</p>
    <p style="margin: 0 0 24px; font-size: 32px; font-weight: 700; letter-spacing: 8px;">${code}</p>
    <p style="margin: 0; color: #64748b; font-size: 13px;">The code expires in 15 minutes. If you didn't request it, ignore this email.</p>
  </div>`;

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

  const text = `Hi,

${opts.inviterName} invited you to join ${opts.orgName} on Tickets as ${roleLabel}${projectLine}.

Use this link to set up your account (or sign in if you already have one):

${opts.inviteUrl}

The invite expires in 14 days. If you weren't expecting this, you can ignore this email.`;

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0f172a;">
    <h2 style="margin: 0 0 12px;">Join ${opts.orgName}</h2>
    <p style="margin: 0 0 16px; color: #475569;">
      ${opts.inviterName} invited you to join <strong>${opts.orgName}</strong> on Tickets as
      <strong>${roleLabel}</strong>${projectLine}.
    </p>
    <p style="margin: 0 0 24px;">
      <a href="${opts.inviteUrl}" style="background: #4f46e5; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; display: inline-block;">Accept invite</a>
    </p>
    <p style="margin: 0 0 8px; color: #64748b; font-size: 13px;">The invite expires in 14 days. If you weren't expecting this, ignore this email.</p>
    <p style="margin: 16px 0 0; color: #94a3b8; font-size: 12px; word-break: break-all;">${opts.inviteUrl}</p>
  </div>`;

  return { to: "", subject: `You've been invited to ${opts.orgName} on Tickets`, html, text };
}

export function passwordResetEmail(name: string, resetUrl: string): SendEmailOpts {
  const text = `Hi ${name},

We received a request to reset your Tickets password. Use the link below to choose a new one. This link expires in 1 hour.

${resetUrl}

If you didn't request this, you can safely ignore this email — your password won't change.`;

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0f172a;">
    <h2 style="margin: 0 0 12px;">Reset your password</h2>
    <p style="margin: 0 0 16px; color: #475569;">Hi ${name}, we received a request to reset your Tickets password.</p>
    <p style="margin: 0 0 24px;">
      <a href="${resetUrl}" style="background: #4f46e5; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; display: inline-block;">Choose a new password</a>
    </p>
    <p style="margin: 0 0 8px; color: #64748b; font-size: 13px;">This link expires in 1 hour. If you didn't request it, ignore this email — your password won't change.</p>
    <p style="margin: 16px 0 0; color: #94a3b8; font-size: 12px; word-break: break-all;">${resetUrl}</p>
  </div>`;

  return { to: "", subject: "Reset your Tickets password", html, text };
}
