import { useCallback, useMemo, useRef } from "react";
import { useSearchParams, useLocation, type NavigateOptions, type URLSearchParamsInit } from "react-router-dom";

/** Rows-per-page choices offered in the UI (the API accepts 1–100). */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

const SIZE_STORAGE_KEY = "tm_ticket_page_size";

function readStoredSize(): number | null {
  try {
    const n = Number(localStorage.getItem(SIZE_STORAGE_KEY));
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : null;
  } catch {
    return null; // storage can be blocked/unavailable — it's only a convenience
  }
}

function writeStoredSize(n: number) {
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, String(n));
  } catch {
    /* ignore */
  }
}

interface Options {
  /** URL param holding the page number. */
  pageKey?: string;
  /** URL param holding rows-per-page. */
  sizeKey?: string;
  /**
   * Filters kept in the URL: param name → allowed values. Anything not in
   * the allowed list (typo, stale link) is ignored rather than sent to the API.
   */
  filters?: Record<string, readonly string[]>;
  /**
   * Extra filters whose value is a calendar date ("yyyy-mm-dd") rather than one
   * of a fixed list. Anything that isn't a real date is ignored.
   */
  dateKeys?: readonly string[];
}

/**
 * Pagination + filter state for a list, stored in the URL query string so it
 * survives refresh, back/forward and shared links.
 *
 * - Changing a filter or the page size ALWAYS drops back to page 1, in the
 *   same URL update (no intermediate request for a page that may not exist).
 * - The chosen page size is remembered in localStorage and used as the
 *   default next time, and is preserved across filter changes.
 */
export function useListParams({ pageKey = "page", sizeKey = "pageSize", filters = {}, dateKeys = [] }: Options = {}) {
  const [params, setParamsRaw] = useSearchParams();
  // setSearchParams navigates without the current router state, which would
  // erase e.g. the "Back to <member>" context a page was opened with. Carry it over.
  const { state: routeState } = useLocation();
  const stateRef = useRef(routeState);
  stateRef.current = routeState;
  const setParams = useCallback(
    (
      next: URLSearchParamsInit | ((prev: URLSearchParams) => URLSearchParamsInit),
      opts?: NavigateOptions,
    ) => setParamsRaw(next, { ...opts, state: stateRef.current }),
    [setParamsRaw],
  );

  const page = useMemo(() => {
    const n = parseInt(params.get(pageKey) ?? "", 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }, [params, pageKey]);

  const pageSize = useMemo(() => {
    const n = Number(params.get(sizeKey));
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) return n;
    return readStoredSize() ?? DEFAULT_PAGE_SIZE;
  }, [params, sizeKey]);

  // Stable identity for the filter spec so the memo below doesn't churn.
  const filterSpec = JSON.stringify(filters);
  const dateSpec = JSON.stringify(dateKeys);
  const filterValues = useMemo(() => {
    const spec = JSON.parse(filterSpec) as Record<string, string[]>;
    const out: Record<string, string> = {};
    for (const [key, allowed] of Object.entries(spec)) {
      const v = params.get(key) ?? "";
      out[key] = allowed.includes(v) ? v : "";
    }
    for (const key of JSON.parse(dateSpec) as string[]) {
      const v = params.get(key) ?? "";
      out[key] = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : "";
    }
    return out;
  }, [params, filterSpec, dateSpec]);

  const setPage = useCallback(
    (next: number, opts?: { replace?: boolean }) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (next <= 1) n.delete(pageKey);
          else n.set(pageKey, String(next));
          return n;
        },
        { replace: opts?.replace ?? false },
      );
    },
    [setParams, pageKey],
  );

  const setPageSize = useCallback(
    (size: number) => {
      writeStoredSize(size);
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set(sizeKey, String(size)); // explicit, so it beats the stored default
          n.delete(pageKey); // back to page 1
          return n;
        },
        { replace: true },
      );
    },
    [setParams, sizeKey, pageKey],
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (value) n.set(key, value);
          else n.delete(key);
          n.delete(pageKey); // back to page 1; page size param is left alone
          return n;
        },
        { replace: true },
      );
    },
    [setParams, pageKey],
  );

  /** Set several filters in ONE URL update (used for a page's default view). */
  const setFilters = useCallback(
    (values: Record<string, string>) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(values)) {
            if (value) n.set(key, value);
            else n.delete(key);
          }
          n.delete(pageKey);
          return n;
        },
        { replace: true },
      );
    },
    [setParams, pageKey],
  );

  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const key of [...Object.keys(JSON.parse(filterSpec)), ...(JSON.parse(dateSpec) as string[])]) n.delete(key);
        n.delete(pageKey);
        return n;
      },
      { replace: true },
    );
  }, [setParams, filterSpec, dateSpec, pageKey]);

  return { page, pageSize, filters: filterValues, setPage, setPageSize, setFilter, setFilters, clearFilters };
}
