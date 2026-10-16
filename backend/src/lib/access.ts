import type { OrgMembership, OrgRole, User } from "../db/types.js";
export type AuthUser = User & { memberships: OrgMembership[] };
export function orgRole(user: AuthUser, orgId: string): OrgRole | null {
  return user.memberships.find((m) => m.orgId === orgId)?.role ?? null;
}
export function canAccessOrg(user: AuthUser, orgId: string): boolean {
  return orgRole(user, orgId) !== null;
}
export function isOrgSA(user: AuthUser, orgId: string): boolean {
  return orgRole(user, orgId) === "SUPER_ADMIN";
}
export function isAdminOrAbove(user: AuthUser, orgId: string): boolean {
  const role = orgRole(user, orgId);
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
export function isInternal(user: AuthUser, orgId: string): boolean {
  const role = orgRole(user, orgId);
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "DEVELOPER";
}
export function isClient(user: AuthUser, orgId: string): boolean {
  return orgRole(user, orgId) === "CLIENT";
}
export function membershipIn(user: AuthUser, orgId: string): OrgMembership | null {
  return user.memberships.find((m) => m.orgId === orgId) ?? null;
}
export function isPlatformSuperAdmin(user: AuthUser): boolean {
  return user.platformRole === "SUPER_ADMIN" && user.platformAdminActive === true;
}
export function canCreateOrganisation(user: Pick<AuthUser, "memberships">): boolean {
  return user.memberships.some((m) => m.role === "SUPER_ADMIN" && !m.disabled);
}