import "dotenv/config";
import { getPrimaryNetworkAddress } from "./lib/network.js";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export type EmailProvider = "brevo" | "smtp" | "both" | "console";

const brevoApiKey = process.env.BREVO_API_KEY ?? "";

const defaultFrontendHost = process.env.FRONTEND_HOST ?? getPrimaryNetworkAddress() ?? "localhost";
const defaultFrontendOrigin = `http://${defaultFrontendHost}`;

const fixedFrontendOrigins = [
  "https://ticketmanagement.site",
  "https://www.ticketmanagement.site",
  "http://localhost:5173",
  defaultFrontendOrigin,
];

export function getCorsOrigins(value?: string, fallback = defaultFrontendOrigin): string[] {
  const sources = (value ?? fallback)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Prefer explicit sources (from FRONTEND_URL) first so deployments
  // that set a custom origin (including non-standard ports) take priority
  // over the built-in fixed list used for local dev/testing.
  const uniqueOrigins = [...new Set([...sources, ...fixedFrontendOrigins])];
  return uniqueOrigins.length > 0 ? uniqueOrigins : [fallback];
}

/**
 * Which transport sends email. Priority:
 *   1. EMAIL_PROVIDER=brevo | smtp | both | console  (explicit choice always wins;
 *      "both" = Mailpit copy AND real delivery through Brevo, e.g. so mail to
 *      mailinator.com actually arrives while you still see it in Mailpit)
 *   2. NODE_ENV=production      -> Brevo (console log if there is no API key)
 *   3. NODE_ENV=development/test-> smtp (Mailpit on localhost:1025), even if a
 *                                  Brevo key is lying around in .env
 *   4. NODE_ENV unset           -> Brevo if a key exists (keeps old behaviour),
 *                                  otherwise smtp
 */
function resolveEmailProvider(): EmailProvider {
  const explicit = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "brevo" || explicit === "smtp" || explicit === "both" || explicit === "console") return explicit;
  if (explicit) {
    console.warn(`[email] Unknown EMAIL_PROVIDER="${explicit}" (use brevo, smtp, both or console) — using the default for this environment.`);
  }
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production") return brevoApiKey ? "brevo" : "console";
  if (nodeEnv === undefined || nodeEnv === "") return brevoApiKey ? "brevo" : "smtp";
  return "smtp";
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: (process.env.NODE_ENV ?? "development") === "production",

  databaseUrl: required("DATABASE_URL"),

  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "tm_session",

  // The deployed frontend's origin. This is the ONLY place that builds
  // links back to the frontend (invite links, password/PIN reset links,
  // org-creation verification links, Telegram/notification "view ticket"
  // links) — see notify.ts, routes/auth.ts, routes/invites.ts, routes/orgs.ts.
  // In production this MUST be set to the real deployed frontend origin
  // (e.g. "https://your-domain.com") via the FRONTEND_URL env var; the
  // fallback below is a dev convenience only (matches this repo's dev
  // frontend port, see frontend/vite.config.ts) and should never be relied
  // on outside local development.
  frontendUrl: getCorsOrigins(process.env.FRONTEND_URL, defaultFrontendOrigin)[0],
  frontendOrigins: getCorsOrigins(process.env.FRONTEND_URL, defaultFrontendOrigin),

  // Transactional email (signup OTPs, invites, password resets).
  //   production : Brevo's HTTP API (Render blocks outbound SMTP ports on its
  //                free tier — see lib/email.ts for the full story)
  //   development: Mailpit over plain SMTP (localhost:1025, UI on :8025)
  //   console    : just prints the email to the server log
  // See resolveEmailProvider() above and the "Email" section of the README.
  email: {
    provider: resolveEmailProvider(),
    brevoApiKey,
    from: process.env.SMTP_FROM ?? "Ticketmanagement <no-reply@example.com>",
    // Only used by the "smtp" provider. Defaults match Mailpit's.
    smtp: {
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
    },
    /** True when a real transport is active (drives the "password reset available" flag). */
    get enabled() {
      return this.provider === "smtp" || this.provider === "both" || (this.provider === "brevo" && Boolean(this.brevoApiKey));
    },
  },

  twoFactorCookieName: process.env.TWO_FACTOR_COOKIE_NAME ?? "tm_2fa_pending",

  // Attachments (local disk for now; swap to S3/R2 for production PaaS).
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),
};