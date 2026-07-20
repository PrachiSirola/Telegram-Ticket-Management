import type { OrgMembership, OrgRole, User } from "@prisma/client";

// req.user shape: the account plus its ACTIVE (non-disabled) org memberships.
export type AuthUser = User & { memberships: OrgMembership[] };

/** The user's role within an org, or null if not an active member. */
export function orgRole(user: AuthUser, orgId: string): OrgRole | null {
  return user.memberships.find((m) => m.orgId === orgId)?.role ?? null;
}

/** Is the user an active member of the org at all? */
export function canAccessOrg(user: AuthUser, orgId: string): boolean {
  return orgRole(user, orgId) !== null;
}

/** The org's single owner. */
export function isOrgSA(user: AuthUser, orgId: string): boolean {
  return orgRole(user, orgId) === "SUPER_ADMIN";
}

/** SA or Admin — manages projects, members (below Admin), invites. */
export function isAdminOrAbove(user: AuthUser, orgId: string): boolean {
  const role = orgRole(user, orgId);
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/** Internal team (SA/Admin/Developer) — sees all projects + internal data. */
export function isInternal(user: AuthUser, orgId: string): boolean {
  const role = orgRole(user, orgId);
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "DEVELOPER";
}

/** External client — per-project access, client-visible data only. */
export function isClient(user: AuthUser, orgId: string): boolean {
  return orgRole(user, orgId) === "CLIENT";
}

/** The user's membership row in an org (for ProjectClient lookups). */
export function membershipIn(user: AuthUser, orgId: string): OrgMembership | null {
  return user.memberships.find((m) => m.orgId === orgId) ?? null;
}
