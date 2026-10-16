import type { ClientSession } from "mongoose";
import { db } from "../db/index.js";
import type { ActivityType } from "../db/types.js";

export interface ActivityInput {
  ticketId: string;
  actorId: string;
  type: ActivityType;
  field?: string;
  from?: string | null;
  to?: string | null;
  meta?: Record<string, unknown>;
  internalOnly?: boolean;
}


export function logActivity(session: ClientSession | undefined, a: ActivityInput) {
  return db.activity.create(activityRow(a), { session });
}

export function activityRow(a: ActivityInput) {
  return {
    ticketId: a.ticketId,
    actorId: a.actorId,
    type: a.type,
    field: a.field ?? null,
    fromValue: a.from ?? null,
    toValue: a.to ?? null,
    meta: a.meta ?? null,
    internalOnly: a.internalOnly ?? false,
  };
}
