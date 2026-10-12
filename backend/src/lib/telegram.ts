export interface TelegramConfig {
  botToken: string;
  chatId: string;
}
export async function sendTelegram(cfg: TelegramConfig | null, text: string) {
  if (!cfg?.botToken || !cfg.chatId) {
    console.log(`\n[telegram:console]\n${text}\n`);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error("[telegram] send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[telegram] send error:", err);
  }
}
