import type { ClientSession } from "mongoose";
import { db, type Filter } from "../db/index.js";
import type { Ticket } from "../db/types.js";
import { fixFilter, plain } from "../db/dao.js";

export type TicketOrder = "updated" | "due";
export async function queryTickets(
  filter: Filter,
  order: TicketOrder,
  page?: { skip: number; take: number },
  session?: ClientSession,
): Promise<Ticket[]> {
  if (order === "updated") {
    return db.tickets.find(filter, {
      sort: { updatedAt: -1, _id: -1 },
      skip: page?.skip,
      limit: page?.take,
      session,
    });
  }
  const pipeline: any[] = [
    { $match: fixFilter(filter) },
    { $addFields: { _noDue: { $cond: [{ $eq: [{ $ifNull: ["$dueDate", null] }, null] }, 1, 0] } } },
    { $sort: { _noDue: 1, dueDate: 1, updatedAt: -1, _id: -1 } },
    ...(page ? [{ $skip: page.skip }, { $limit: page.take }] : []),
    { $project: { _noDue: 0, __v: 0 } },
  ];
  const rows = await db.tickets.aggregate(pipeline, { session });
  return rows.map((r) => plain<Ticket>(r));
}
