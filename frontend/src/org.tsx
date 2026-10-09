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

// The remembered workspace is stored PER USER. A single shared key used to leak
// from one account to the next on the same browser: sign out of org A's admin,
// sign in as someone who belongs to both orgs, and every org-scoped action
// (invites included) silently went to the previous person's workspace.
const LEGACY_KEY = "tm_active_org";
const keyFor = (userId: string) => `tm_active_org:${userId}`;
// Set by the invite-accept flow so the person lands in the org they just joined.
const PENDING_KEY = "tm_pending_org";

export function rememberJoinedOrg(orgId: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, orgId);
  } catch {
    /* storage unavailable — falls back to the first org */
  }
}

export function forgetActiveOrg(userId: string | undefined) {
  try {
    if (userId) localStorage.removeItem(keyFor(userId));
  } catch {
    /* ignore */
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [storedId, setStoredId] = useState<string>("");

  // Load this user's remembered workspace whenever the signed-in user changes
  // (login, logout, switching accounts) — never another account's choice.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_KEY); // shared across accounts; can't be trusted
    } catch {
      /* ignore */
    }
    if (!me) {
      setStoredId("");
      return;
    }
    let id = "";
    try {
      id = localStorage.getItem(keyFor(me.id)) ?? "";
    } catch {
      /* ignore */
    }
    setStoredId(id);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    try {
      if (me) localStorage.setItem(keyFor(me.id), orgId);
    } catch {
      /* ignore */
    }
    setStoredId(orgId);
  }

  // Just accepted an invite? Open that organisation rather than a stale one.
  useEffect(() => {
    if (!me || !orgs) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    if (!pending) return;
    if (orgs.some((o) => o.id === pending)) {
      try {
        sessionStorage.removeItem(PENDING_KEY);
      } catch {
        /* ignore */
      }
      setActiveOrg(pending);
    }
  }, [me, orgs]); // eslint-disable-line react-hooks/exhaustive-deps

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