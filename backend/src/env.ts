import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export type EmailProvider = "brevo" | "smtp" | "both" | "console";

const brevoApiKey = process.env.BREVO_API_KEY ?? "";
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
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:1020",

  email: {
    provider: resolveEmailProvider(),
    brevoApiKey,
    from: process.env.SMTP_FROM ?? "Ticketmanagement <no-reply@example.com>",
    smtp: {
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
    },
    get enabled() {
      return this.provider === "smtp" || this.provider === "both" || (this.provider === "brevo" && Boolean(this.brevoApiKey));
    },
  },

  twoFactorCookieName: process.env.TWO_FACTOR_COOKIE_NAME ?? "tm_2fa_pending",
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),
};