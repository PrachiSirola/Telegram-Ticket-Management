import type { ActivityType, Prisma } from "@prisma/client";
type Db = { ticketActivity: Prisma.TransactionClient["ticketActivity"] };

export interface ActivityInput {
  ticketId: string;
  actorId: string;
  type: ActivityType;
  field?: string;
  from?: string | null;
  to?: string | null;
  meta?: Prisma.InputJsonValue;
  internalOnly?: boolean;
}
export function logActivity(db: Db, a: ActivityInput) {
  return db.ticketActivity.create({
    data: {
      ticketId: a.ticketId,
      actorId: a.actorId,
      type: a.type,
      field: a.field ?? null,
      fromValue: a.from ?? null,
      toValue: a.to ?? null,
      meta: a.meta ?? undefined,
      internalOnly: a.internalOnly ?? false,
    },
  });
}