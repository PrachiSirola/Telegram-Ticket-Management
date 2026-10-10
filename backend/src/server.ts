import { createApp } from "./app.js";
import { env } from "./env.js";

const app = createApp();
app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
  const emailMode =
    env.email.provider === "both"
      ? `Mailpit at ${env.email.smtp.host}:${env.email.smtp.port} (http://localhost:8025) + Brevo for real delivery${env.email.brevoApiKey ? "" : " — BREVO_API_KEY is NOT set, real delivery will fail"}`
      : env.email.provider === "smtp"
      ? `Mailpit/SMTP at ${env.email.smtp.host}:${env.email.smtp.port} (inbox UI: http://localhost:8025)`
      : env.email.provider === "brevo"
        ? env.email.brevoApiKey
          ? "Brevo API"
          : "Brevo API — BREVO_API_KEY is NOT set, emails will fail"
        : "console (printed to this log)";
  console.log(`  Email: ${emailMode}`);
  console.log(`  Frontend URL: ${env.frontendUrl}`);

  // Invite links, password/PIN reset links, and org-creation verification
  // links are all built from FRONTEND_URL (see env.ts). If it's still
  // pointing at localhost in production, every link sent to real users is
  // broken — surface that immediately instead of letting it fail silently.
  if (env.isProd && env.frontendUrl.includes("localhost")) {
    console.warn(
      "  WARNING: FRONTEND_URL is set to a localhost address in production. " +
        "Set FRONTEND_URL to this app's real deployed frontend origin " +
        "(e.g. https://your-domain.com) so invite/reset links work for users.",
    );
  }
});