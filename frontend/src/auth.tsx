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
    setMe(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

// --- Org-scoped role helpers (there is no global role anymore) ---

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

/** Exactly DEVELOPER (not SA/Admin, even though they're also "internal") —
 *  used to gate the "My Work" sidebar link, which is specifically a
 *  developer-focused view of their own assignments. */
export const isDeveloperIn = (me: Me | null, orgId: string) => roleInOrg(me, orgId) === "DEVELOPER";

/**
 * Only users who currently hold SUPER_ADMIN, ADMIN, or CLIENT in at least
 * one of their org memberships may create a new organisation. A user whose
 * memberships are all DEVELOPER — or who has none at all — cannot; they
 * need an invite instead. This mirrors the backend check in
 * routes/orgs.ts exactly; the backend is the authoritative enforcement,
 * this is just so the UI doesn't show an option that would be rejected.
 */

/*export const canCreateOrg = (me: Me | null) =>
  Boolean(
    me?.memberships.some((m) => m.role === "SUPER_ADMIN" || m.role === "ADMIN" || m.role === "CLIENT"),
  );*/

  /**
 * Only the single fixed platform Super Admin may create a new organisation —
 * an account-level flag (set manually, outside the app), completely separate
 * from any per-org role. This mirrors the backend check in
 * lib/access.ts isPlatformSuperAdmin exactly; the backend is the
 * authoritative enforcement, this is just so the UI doesn't show an option
 * that would be rejected.
 */
export const canCreateOrg = (me: Me | null) => Boolean(me?.isPlatformSuperAdmin);