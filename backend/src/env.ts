import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 1019),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: (process.env.NODE_ENV ?? "development") === "production",

  databaseUrl: required("DATABASE_URL"),

  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "tm_session",

  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:1020",

  // Transactional email (signup OTPs, password-reset links).
  // Driver precedence: SMTP_URL (local Mailpit) → RESEND_API_KEY → console log.
  email: {
    smtpUrl: process.env.SMTP_URL ?? "", // e.g. smtp://localhost:1025 (Mailpit)
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? "Tickets <onboarding@resend.dev>",
    get enabled() {
      return Boolean(this.smtpUrl || this.resendApiKey);
    },
  },

  // Attachments (local disk for now; swap to S3/R2 for production PaaS).
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),
};
