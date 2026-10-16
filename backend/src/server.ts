import { createApp } from "./app.js";
import { env } from "./env.js";
import { getNetworkAddresses } from "./lib/network.js";
import { connectDb, transactionsEnabled } from "./db/index.js";
import { dbHost, dbName, runStartupUpgrades } from "./db/upgrades.js";

await connectDb();
console.log(
  `MongoDB connected successfully (database: ${dbName()}, host: ${dbHost()}, transactions: ${transactionsEnabled() ? "on" : "off"})`,
);
await runStartupUpgrades();
const app = createApp();
const host = process.env.HOST ?? "0.0.0.0";

app.listen(env.port, host, () => {
  const networkAddresses = getNetworkAddresses();
  const urls = [`http://localhost:${env.port}`].concat(
    networkAddresses.map((ip) => `http://${ip}:${env.port}`),
  );

  console.log(`API listening on ${urls.join(" | ")}`);
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
  if (env.isProd && env.frontendUrl.includes("localhost")) {
    console.warn(
      "  WARNING: FRONTEND_URL is set to a localhost address in production. " +
        "Set FRONTEND_URL to this app's real deployed frontend origin " +
        "(e.g. https://your-domain.com) so invite/reset links work for users.",
    );
  }
});