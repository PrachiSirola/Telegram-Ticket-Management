import { createApp } from "./app.js";
import { env } from "./env.js";

const app = createApp();
app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
  const emailMode = env.email.enabled
    ? `Gmail SMTP (as ${env.email.user})`
    : "console fallback";
  console.log(`  Email: ${emailMode}`);
});