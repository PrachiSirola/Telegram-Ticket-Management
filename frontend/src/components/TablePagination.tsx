import { IconArrowLeft, IconArrowRight } from "./Icons";
import { PAGE_SIZE_OPTIONS } from "../lib/useListParams";
export function pageItems(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const keep = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach((n) => keep.add(n));
  const sorted = [...keep].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  noun = "tickets",
  busy = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  noun?: string;
  busy?: boolean;
}) {
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const atFirst = current <= 1;
  const atLast = current >= totalPages;
  const showEnds = totalPages > 3;
  const noun1 = total === 1 ? noun.replace(/s$/, "") : noun;

  const numBtn = "btn btn-sm !px-0 min-w-[2.25rem] justify-center";

  return (
    <nav
      aria-label="Pagination"
      aria-busy={busy}
      className="mt-4 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between"
    >
      <p className="whitespace-nowrap text-sm text-fg-soft" aria-live="polite">
        Showing <span className="font-semibold text-fg">{from}–{to}</span> of{" "}
        <span className="font-semibold text-fg">{total}</span> {noun1}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
        <label className="flex items-center justify-between gap-2 text-sm text-fg-soft sm:justify-start">
          <span>Rows per page</span>
          <select
            className="input !w-auto !py-1.5"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-1.5 sm:justify-start">
          {showEnds && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={atFirst}
              onClick={() => onPageChange(1)}
              aria-label="First page"
              title="First page"
            >
              «
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={atFirst}
            onClick={() => onPageChange(current - 1)}
          >
            <IconArrowLeft size={14} />
            <span className="max-sm:sr-only">Previous</span>
          </button>

          {/* Numbered pages from sm up; a plain "Page X of Y" on phones. */}
          <div className="hidden items-center gap-1.5 sm:flex">
            {pageItems(current, totalPages).map((it, i) =>
              it === "gap" ? (
                <span key={`gap-${i}`} className="px-1 text-muted" aria-hidden>
                  …
                </span>
              ) : (
                <button
                  key={it}
                  type="button"
                  className={`${numBtn} ${it === current ? "btn-primary" : "btn-secondary"}`}
                  aria-current={it === current ? "page" : undefined}
                  aria-label={`Page ${it}`}
                  onClick={() => it !== current && onPageChange(it)}
                >
                  {it}
                </button>
              ),
            )}
          </div>
          <span className="px-1 text-sm text-fg-soft sm:hidden">
            Page <span className="font-semibold text-fg">{current}</span> of{" "}
            <span className="font-semibold text-fg">{totalPages}</span>
          </span>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={atLast}
            onClick={() => onPageChange(current + 1)}
          >
            <span className="max-sm:sr-only">Next</span>
            <IconArrowRight size={14} />
          </button>
          {showEnds && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={atLast}
              onClick={() => onPageChange(totalPages)}
              aria-label="Last page"
              title="Last page"
            >
              »
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}