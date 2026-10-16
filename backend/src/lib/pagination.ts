export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface PageMeta extends PageParams {
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paged<T> extends PageMeta {
  items: T[];
}
export function wantsPagination(query: Record<string, unknown>): boolean {
  return query.page !== undefined;
}

function toInt(v: unknown): number {
  return parseInt(String(v ?? ""), 10);
}
export function parsePageParams(
  query: Record<string, unknown>,
  defaultSize = DEFAULT_PAGE_SIZE,
): PageParams {
  const page = Math.max(1, toInt(query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(query.pageSize) || defaultSize));
  return { page, pageSize };
}

export function buildMeta(total: number, req: PageParams): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / req.pageSize));
  const page = Math.min(req.page, totalPages);
  return {
    total,
    page,
    pageSize: req.pageSize,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
export async function paginate<T>(
  req: PageParams,
  count: () => Promise<number>,
  fetch: (skip: number, take: number) => Promise<T[]>,
): Promise<Paged<T>> {
  const total = await count();
  const meta = buildMeta(total, req);
  const items = total === 0 ? [] : await fetch((meta.page - 1) * meta.pageSize, meta.pageSize);
  return { items, ...meta };
}
