import { useCallback, useMemo, useRef } from "react";
import { useSearchParams, useLocation, type NavigateOptions, type URLSearchParamsInit } from "react-router-dom";

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
    /* ignore */
  }
}

interface Options {

  pageKey?: string;

  sizeKey?: string;

  filters?: Record<string, readonly string[]>;

  dateKeys?: readonly string[];

  textKeys?: readonly string[];

  resetKeys?: readonly string[];

  defaultPageSize?: number;
}


export function useListParams({ pageKey = "page", sizeKey = "pageSize", filters = {}, dateKeys = [], textKeys = [], resetKeys = [], defaultPageSize }: Options = {}) {
  const [params, setParamsRaw] = useSearchParams();

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
    return readStoredSize() ?? defaultPageSize ?? DEFAULT_PAGE_SIZE;
  }, [params, sizeKey, defaultPageSize]);


  const filterSpec = JSON.stringify(filters);
  const dateSpec = JSON.stringify(dateKeys);
  const textSpec = JSON.stringify(textKeys);
  const resetSpec = JSON.stringify(resetKeys);
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
    for (const key of JSON.parse(textSpec) as string[]) out[key] = (params.get(key) ?? "").trim().slice(0, 200);
    return out;
  }, [params, filterSpec, dateSpec, textSpec]);


  const dropPages = useCallback((n: URLSearchParams) => {
    n.delete(pageKey);
    for (const k of JSON.parse(resetSpec) as string[]) n.delete(k);
  }, [pageKey, resetSpec]);

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
          dropPages(n); 
          return n;
        },
        { replace: true },
      );
    },
    [setParams, sizeKey, dropPages],
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (value) n.set(key, value);
          else n.delete(key);
          dropPages(n); 
          return n;
        },
        { replace: true },
      );
    },
    [setParams, dropPages],
  );

  
  const setFilters = useCallback(
    (values: Record<string, string>) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(values)) {
            if (value) n.set(key, value);
            else n.delete(key);
          }
          dropPages(n);
          return n;
        },
        { replace: true },
      );
    },
    [setParams, dropPages],
  );

  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const key of [...Object.keys(JSON.parse(filterSpec)), ...(JSON.parse(dateSpec) as string[]), ...(JSON.parse(textSpec) as string[])]) n.delete(key);
        dropPages(n);
        return n;
      },
      { replace: true },
    );
  }, [setParams, filterSpec, dateSpec, textSpec, dropPages]);

  
  const setParam = useCallback(
    (key: string, value: string, opts?: { replace?: boolean }) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (value) n.set(key, value);
          else n.delete(key);
          return n;
        },
        { replace: opts?.replace ?? false },
      );
    },
    [setParams],
  );

  return { page, pageSize, filters: filterValues, setPage, setPageSize, setFilter, setFilters, clearFilters, setParam, params };
}
