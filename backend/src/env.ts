import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: (process.env.NODE_ENV ?? "development") === "production",

  databaseUrl: required("DATABASE_URL"),

  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "tm_session",

  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",

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

  // Attachments (local disk for now; swap to S3/R2 for production PaaS).
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),
};