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
/** The user's membership row in an org (for ProjectClient lookups). */
export function membershipIn(user: AuthUser, orgId: string): OrgMembership | null {
  return user.memberships.find((m) => m.orgId === orgId) ?? null;
}

/**
 * The single, fixed platform-level admin — completely separate from any
 * per-org role. Only an account with platformRole "SUPER_ADMIN" AND
 * platformAdminActive true may create new organisations. This is the sole
 * gate for org creation; ordinary org SUPER_ADMIN/ADMIN/CLIENT roles no
 * longer qualify.
 */
export function isPlatformSuperAdmin(user: AuthUser): boolean {
  return user.platformRole === "SUPER_ADMIN" && user.platformAdminActive === true;
}

/**
 * Who may create a new organisation: anyone who is the (active) Super Admin of
 * at least one organisation. Admins, Developers and Clients never qualify.
 * This is the single gate used by both the UI hint (mirrored in the frontend's
 * canCreateOrg) and the backend routes/services, so it can't drift.
 *
 * History: this used to be the account-level platform flag above (set only by
 * a CLI script), which silently removed the option from every ordinary org
 * Super Admin — that is why "New organisation" disappeared.
 */
export function canCreateOrganisation(user: Pick<AuthUser, "memberships">): boolean {
  return user.memberships.some((m) => m.role === "SUPER_ADMIN" && !m.disabled);
}