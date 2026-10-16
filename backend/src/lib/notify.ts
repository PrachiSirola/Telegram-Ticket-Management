import { db } from "../db/index.js";
import type { NotificationType } from "../db/types.js";
import { env } from "../env.js";
import { sendTelegram } from "./telegram.js";

interface NotifyOpts {
  recipientIds: string[];
  type: NotificationType;
  ticket: { id: string; title: string; projectId: string };
  orgId: string; 
  actorId: string; 
  message: string; 
  telegram?: boolean; 
  telegramMessage?: string; 
}
export function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
export async function notify(opts: NotifyOpts) {
  const candidates = [...new Set(opts.recipientIds)].filter(
    (id) => id && id !== opts.actorId,
  );

  let recipients: string[] = [];
  if (candidates.length > 0) {
    const memberships = await db.memberships.find({ orgId: opts.orgId, userId: { $in: candidates }, disabled: false });
    const clientIds = memberships.filter((m) => m.role === "CLIENT").map((m) => m.id);
    const attached = new Set(
      clientIds.length
        ? await db.projectClients.distinct("membershipId", {
            projectId: opts.ticket.projectId,
            membershipId: { $in: clientIds },
          })
        : [],
    );
    recipients = memberships.filter((m) => m.role !== "CLIENT" || attached.has(m.id)).map((m) => m.userId);
  }

  if (recipients.length > 0) {
    await db.notifications.createMany(
      recipients.map((userId) => ({
        userId,
        type: opts.type,
        ticketId: opts.ticket.id,
        payload: { message: opts.message, ticketTitle: opts.ticket.title },
      })),
    );
  }

  if (opts.telegram) {
    const org = await db.orgs.byId(opts.orgId);
    const cfg =
      org?.telegramBotToken && org.telegramChatId
        ? { botToken: org.telegramBotToken, chatId: org.telegramChatId }
        : null;
    const url = `${env.frontendUrl}/tickets/${opts.ticket.id}`;
    await sendTelegram(cfg, `${opts.telegramMessage ?? opts.message}\n<a href="${url}">View ticket</a>`);
  }
}
