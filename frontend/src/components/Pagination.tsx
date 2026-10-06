import { IconArrowLeft, IconArrowRight } from "./Icons";

/**
 * ← Previous / Next → pagination controls, with a "Page X of Y" indicator.
 * Purely presentational — the page state itself lives in whichever page
 * uses this (Dashboard's project grid, Members' member list), so filters/
 * search on those pages naturally carry over across page changes since
 * they're just other pieces of the same component's state.
 */
export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  return (
    <div className="mt-5 flex items-center justify-center gap-3 sm:gap-2">
      <button
        className="btn btn-secondary btn-sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <IconArrowLeft size={14} />
        Previous
      </button>

      <span className="text-sm text-fg-soft">
        Page <span className="font-semibold text-fg">{page}</span> of{" "}
        <span className="font-semibold text-fg">{totalPages}</span>
      </span>

      <button
        className="btn btn-secondary btn-sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
        <IconArrowRight size={14} />
      </button>
    </div>
  );
}