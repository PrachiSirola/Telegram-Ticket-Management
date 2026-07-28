import { createApp } from "./app.js";
import { env } from "./env.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);

  const emailMode =
    env.email.user && env.email.pass
      ? `SMTP (${env.email.host}:${env.email.port})`
      : "console fallback";

  console.log(`  Email: ${emailMode}`);
});