import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, http } from "./lib/api";
import { useAuth } from "./auth";
import type { Organization } from "./types";

interface OrgCtx {
  orgs: Organization[];
  activeOrg: Organization | null;
  activeOrgId: string;
  setActiveOrg: (orgId: string) => void;
  loading: boolean;
}

const Ctx = createContext<OrgCtx>(null as never);

const STORAGE_KEY = "tm_active_org";

export function OrgProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [storedId, setStoredId] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "");

  const { data: orgs, isLoading } = useQuery({
    queryKey: ["orgs"],
    queryFn: api.orgs,
    enabled: !!me,
  });

  // localStorage is UX-only: the /orgs response is the authority. A stored id
  // that's no longer in the list (kicked, org deleted) falls back to the first
  // org; users with no orgs get the empty state.
  const activeOrg = useMemo(() => {
    if (!orgs || orgs.length === 0) return null;
    return orgs.find((o) => o.id === storedId) ?? orgs[0];
  }, [orgs, storedId]);

  function setActiveOrg(orgId: string) {
    localStorage.setItem(STORAGE_KEY, orgId);
    setStoredId(orgId);
  }

  // Self-heal: a 403/404 from an org-scoped call usually means our membership
  // changed — refetch the org list so the switcher/active org stay truthful.
  useEffect(() => {
    const id = http.interceptors.response.use(
      (r) => r,
      (error) => {
        const status = error?.response?.status;
        const url: string = error?.config?.url ?? "";
        if ((status === 403 || status === 404) && url.startsWith("/orgs/")) {
          qc.invalidateQueries({ queryKey: ["orgs"] });
        }
        return Promise.reject(error);
      },
    );
    return () => http.interceptors.response.eject(id);
  }, [qc]);

  return (
    <Ctx.Provider
      value={{
        orgs: orgs ?? [],
        activeOrg,
        activeOrgId: activeOrg?.id ?? "",
        setActiveOrg,
        loading: isLoading,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useOrg = () => useContext(Ctx);
