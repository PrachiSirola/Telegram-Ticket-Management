import { createApp } from "./app.js";
import { env } from "./env.js";

const app = createApp();
app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
  const emailMode = env.email.smtpUrl
    ? `SMTP (${env.email.smtpUrl})`
    : env.email.resendApiKey
      ? "Resend"
      : "console fallback";
  console.log(`  Email: ${emailMode}`);
});
