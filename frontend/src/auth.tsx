import { clearListMemory } from "./lib/projectListMemory";
import { toast } from "./lib/toast";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./lib/api";
import type { Me, OrgRole } from "./types";

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.logout();
    clearListMemory();
    setMe(null);
    toast.info("You've been signed out.");
  }

  useEffect(() => {
    refresh();
  }, []);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const roleInOrg = (me: Me | null, orgId: string): OrgRole | null =>
  me?.memberships.find((m) => m.orgId === orgId)?.role ?? null;

export const isOrgSA = (me: Me | null, orgId: string) =>
  roleInOrg(me, orgId) === "SUPER_ADMIN";

export const isAdminOrAboveIn = (me: Me | null, orgId: string) => {
  const r = roleInOrg(me, orgId);
  return r === "SUPER_ADMIN" || r === "ADMIN";
};

export const isInternalIn = (me: Me | null, orgId: string) => {
  const r = roleInOrg(me, orgId);
  return r === "SUPER_ADMIN" || r === "ADMIN" || r === "DEVELOPER";
};

export const isClientIn = (me: Me | null, orgId: string) => roleInOrg(me, orgId) === "CLIENT";

export const isDeveloperIn = (me: Me | null, orgId: string) => roleInOrg(me, orgId) === "DEVELOPER";
export const canCreateOrg = (me: Me | null) =>
  Boolean(me?.memberships.some((m) => m.role === "SUPER_ADMIN"));
