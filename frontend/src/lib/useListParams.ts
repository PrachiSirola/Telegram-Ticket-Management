import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

const SIZE_STORAGE_KEY = "tm_ticket_page_size";

function readStoredSize(): number | null {
  try {
    const n = Number(localStorage.getItem(SIZE_STORAGE_KEY));
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStoredSize(n: number) {
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, String(n));
  } catch {
  }
}

interface Options {
  pageKey?: string;
  sizeKey?: string;
  filters?: Record<string, readonly string[]>;
}
export function useListParams({ pageKey = "page", sizeKey = "pageSize", filters = {} }: Options = {}) {
  const [params, setParams] = useSearchParams();

  const page = useMemo(() => {
    const n = parseInt(params.get(pageKey) ?? "", 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }, [params, pageKey]);

  const pageSize = useMemo(() => {
    const n = Number(params.get(sizeKey));
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) return n;
    return readStoredSize() ?? DEFAULT_PAGE_SIZE;
  }, [params, sizeKey]);

  const filterSpec = JSON.stringify(filters);
  const filterValues = useMemo(() => {
    const spec = JSON.parse(filterSpec) as Record<string, string[]>;
    const out: Record<string, string> = {};
    for (const [key, allowed] of Object.entries(spec)) {
      const v = params.get(key) ?? "";
      out[key] = allowed.includes(v) ? v : "";
    }
    return out;
  }, [params, filterSpec]);

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
          n.set(sizeKey, String(size));
          n.delete(pageKey); 
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
        for (const key of Object.keys(JSON.parse(filterSpec))) n.delete(key);
        n.delete(pageKey);
        return n;
      },
      { replace: true },
    );
  }, [setParams, filterSpec, pageKey]);

  return { page, pageSize, filters: filterValues, setPage, setPageSize, setFilter, clearFilters };
}