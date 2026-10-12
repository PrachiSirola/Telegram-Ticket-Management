import type { NotificationType } from "@prisma/client";
import { prisma } from "../prisma.js";
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
    const memberships = await prisma.orgMembership.findMany({
      where: { orgId: opts.orgId, userId: { in: candidates }, disabled: false },
      include: {
        projectAccess: { where: { projectId: opts.ticket.projectId }, select: { id: true } },
      },
    });
    recipients = memberships
      .filter((m) => m.role !== "CLIENT" || m.projectAccess.length > 0)
      .map((m) => m.userId);
  }

  if (recipients.length > 0) {
    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        type: opts.type,
        ticketId: opts.ticket.id,
        payload: { message: opts.message, ticketTitle: opts.ticket.title },
      })),
    });
  }

  if (opts.telegram) {
    const org = await prisma.organization.findUnique({
      where: { id: opts.orgId },
      select: { telegramBotToken: true, telegramChatId: true },
    });
    const cfg =
      org?.telegramBotToken && org.telegramChatId
        ? { botToken: org.telegramBotToken, chatId: org.telegramChatId }
        : null;
    const url = `${env.frontendUrl}/tickets/${opts.ticket.id}`;
    await sendTelegram(cfg, `${opts.telegramMessage ?? opts.message}\n<a href="${url}">View ticket</a>`);
  }
}
