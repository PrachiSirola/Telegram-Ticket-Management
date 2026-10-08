import "dotenv/config";
import { getPrimaryNetworkAddress } from "./lib/network.js";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const defaultFrontendHost = process.env.FRONTEND_HOST ?? getPrimaryNetworkAddress() ?? "localhost";
const defaultFrontendOrigin = `http://${defaultFrontendHost}:1020`;

const fixedFrontendOrigins = [
  "https://ticketmanagement.site",
  "https://www.ticketmanagement.site",
  "https://ticketmanagement.site:1020",
  "https://www.ticketmanagement.site:1020",
  "http://localhost:1020",
  "http://localhost:5173",
  "https://localhost:1020",
  defaultFrontendOrigin,
];

export function getCorsOrigins(value?: string, fallback = defaultFrontendOrigin): string[] {
  const sources = (value ?? fallback)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const uniqueOrigins = [...new Set([...fixedFrontendOrigins, ...sources])];
  return uniqueOrigins.length > 0 ? uniqueOrigins : [fallback];
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

  // Transactional email (signup OTPs, invites, password resets) via
  // Brevo's HTTP API (not SMTP — Render blocks outbound SMTP ports on
  // its free tier, see lib/email.ts for the full story). Falls back to
  // console logging if BREVO_API_KEY isn't set (e.g. local dev without
  // email configured).
  email: {
    brevoApiKey: process.env.BREVO_API_KEY ?? "",
    from: process.env.SMTP_FROM ?? "Ticketmanagement <no-reply@example.com>",
    get enabled() {
      return Boolean(this.brevoApiKey);
    },
  },

  twoFactorCookieName: process.env.TWO_FACTOR_COOKIE_NAME ?? "tm_2fa_pending",

  // Attachments (local disk for now; swap to S3/R2 for production PaaS).
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),
};