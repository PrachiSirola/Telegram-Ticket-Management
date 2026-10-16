import { randomBytes } from "node:crypto";
import type { ClientSession, Model } from "mongoose";

let lastMs = 0;
let seq = 0;
export function newId(): string {
  const now = Date.now();
  if (now === lastMs) seq += 1;
  else {
    lastMs = now;
    seq = 0;
  }
  return "c" + now.toString(36).padStart(9, "0") + seq.toString(36).padStart(4, "0") + randomBytes(6).toString("hex");
}

export type Filter = Record<string, any>;
export type Sort = Record<string, 1 | -1>;
export interface ReadOpts {
  session?: ClientSession;
  sort?: Sort;
  skip?: number;
  limit?: number;

  select?: string[];

  ci?: boolean;
}


export function fixFilter(f: Filter | undefined): Filter {
  if (!f) return {};
  const out: Filter = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === "id") out._id = v;
    else if ((k === "$and" || k === "$or" || k === "$nor") && Array.isArray(v)) out[k] = v.map((x) => fixFilter(x));
    else out[k] = v;
  }
  return out;
}


export function toUpdate(patch: Record<string, any>): Record<string, any> {
  const upd: Record<string, any> = {};
  const set: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith("$")) upd[k] = v;
    else if (v !== undefined) set[k] = v;
  }
  if (Object.keys(set).length) upd.$set = { ...(upd.$set ?? {}), ...set };
  return upd;
}

export function plain<T>(doc: any): T {
  if (!doc) return doc;
  const { _id, __v, ...rest } = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { id: _id, ...rest } as T;
}

export class NotFoundError extends Error {
  constructor(what = "Record") {
    super(`${what} not found`);
  }
}

export const isDuplicateKey = (e: any) => e?.code === 11000 || e?.cause?.code === 11000;

const CI = { locale: "en", strength: 2 } as const;

export interface Dao<T extends { id: string }> {
  model: Model<any>;
  find(filter?: Filter, o?: ReadOpts): Promise<T[]>;
  findOne(filter: Filter, o?: ReadOpts): Promise<T | null>;
  byId(id: string | null | undefined, o?: ReadOpts): Promise<T | null>;
  mustById(id: string, o?: ReadOpts): Promise<T>;
  count(filter?: Filter, o?: { session?: ClientSession }): Promise<number>;
  exists(filter: Filter, o?: { session?: ClientSession }): Promise<boolean>;
  distinct(field: string, filter?: Filter): Promise<any[]>;
  create(data: Record<string, any>, o?: { session?: ClientSession }): Promise<T>;
  createMany(data: Record<string, any>[], o?: { session?: ClientSession }): Promise<T[]>;

  update(filter: Filter, patch: Record<string, any>, o?: { session?: ClientSession }): Promise<T | null>;

  mustUpdate(filter: Filter, patch: Record<string, any>, o?: { session?: ClientSession }): Promise<T>;

  updateMany(filter: Filter, patch: Record<string, any>, o?: { session?: ClientSession }): Promise<number>;

  upsert(filter: Filter, patch: Record<string, any>, onInsert?: Record<string, any>, o?: { session?: ClientSession }): Promise<T>;
  deleteOne(filter: Filter, o?: { session?: ClientSession }): Promise<number>;
  deleteMany(filter: Filter, o?: { session?: ClientSession }): Promise<number>;
  aggregate<R = any>(pipeline: any[], o?: { session?: ClientSession; ci?: boolean }): Promise<R[]>;
}

export function dao<T extends { id: string }>(model: Model<any>): Dao<T> {
  const apply = (q: any, o?: ReadOpts) => {
    if (o?.session) q.session(o.session);
    if (o?.sort) q.sort(o.sort);
    if (o?.skip) q.skip(o.skip);
    if (o?.limit) q.limit(o.limit);
    if (o?.select) q.select(o.select.join(" "));
    if (o?.ci) q.collation(CI);
    return q;
  };
  const d: Dao<T> = {
    model,
    async find(filter, o) {
      const rows = await apply(model.find(fixFilter(filter)).lean(), o);
      return rows.map((r: any) => plain<T>(r));
    },
    async findOne(filter, o) {
      const r = await apply(model.findOne(fixFilter(filter)).lean(), o);
      return r ? plain<T>(r) : null;
    },
    async byId(id, o) {
      return id ? d.findOne({ _id: id }, o) : null;
    },
    async mustById(id, o) {
      const r = await d.byId(id, o);
      if (!r) throw new NotFoundError(model.modelName);
      return r;
    },
    count: (filter, o) => {
      const q = model.countDocuments(fixFilter(filter));
      if (o?.session) q.session(o.session);
      return q.exec();
    },
    async exists(filter, o) {
      const q = model.exists(fixFilter(filter));
      if (o?.session) q.session(o.session);
      return Boolean(await q);
    },
    async distinct(field, filter) {
      return model.distinct(field, fixFilter(filter));
    },
    async create(data, o) {
      const { id, ...rest } = data;
      const [doc] = await model.create([id ? { _id: id, ...rest } : rest], { session: o?.session });
      return plain<T>(doc);
    },
    async createMany(data, o) {
      if (data.length === 0) return [];
      const docs = await model.insertMany(
        data.map(({ id, ...rest }) => (id ? { _id: id, ...rest } : rest)),
        { session: o?.session, ordered: true },
      );
      return docs.map((x: any) => plain<T>(x));
    },
    async update(filter, patch, o) {
      const upd = toUpdate(patch);
      const r = await model
        .findOneAndUpdate(fixFilter(filter), upd, { new: true, session: o?.session, runValidators: true })
        .lean();
      return r ? plain<T>(r) : null;
    },
    async mustUpdate(filter, patch, o) {
      const r = await d.update(filter, patch, o);
      if (!r) throw new NotFoundError(model.modelName);
      return r;
    },
    async updateMany(filter, patch, o) {
      const upd = toUpdate(patch);
      if (Object.keys(upd).length === 0) return 0;
      const r = await model.updateMany(fixFilter(filter), upd, { session: o?.session, runValidators: true });
      return r.matchedCount;
    },
    async upsert(filter, patch, onInsert = {}, o) {
      const run = () =>
        model
          .findOneAndUpdate(
            fixFilter(filter),
            {
              ...toUpdate(patch),
              $setOnInsert: { ...("_id" in filter || "id" in filter ? {} : { _id: newId() }), ...stripKeys(onInsert, patch) },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true, session: o?.session, runValidators: true },
          )
          .lean();
      try {
        return plain<T>(await run());
      } catch (e) {
        if (isDuplicateKey(e) && !o?.session) return plain<T>(await run()); // lost a race with a concurrent upsert
        throw e;
      }
    },
    async deleteOne(filter, o) {
      const r = await model.deleteOne(fixFilter(filter), { session: o?.session });
      return r.deletedCount;
    },
    async deleteMany(filter, o) {
      const r = await model.deleteMany(fixFilter(filter), { session: o?.session });
      return r.deletedCount;
    },
    async aggregate(pipeline, o) {
      const a = model.aggregate(pipeline);
      if (o?.session) a.session(o.session);
      if (o?.ci) a.collation(CI);
      return a.exec();
    },
  };
  return d;
}


function stripKeys(onInsert: Record<string, any>, patch: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(onInsert)) {
    if (!(k in patch) && v !== undefined) out[k] = v;
  }
  return out;
}
