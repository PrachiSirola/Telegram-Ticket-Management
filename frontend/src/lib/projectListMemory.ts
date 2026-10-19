const key = (orgId: string, projectId: string) => `tm_project_list:${orgId}:${projectId}`;

export function readProjectListMemory(orgId: string, projectId: string): string | null {
  try {
    return sessionStorage.getItem(key(orgId, projectId));
  } catch {
    return null;
  }
}

export function writeProjectListMemory(orgId: string, projectId: string, query: string) {
  try {
    sessionStorage.setItem(key(orgId, projectId), query);
  } catch {
  }
}

export function listQuery(params: URLSearchParams, filterKeys: readonly string[], pageKey = "page"): string {
  const out = new URLSearchParams();
  for (const k of [...filterKeys, pageKey]) {
    const v = params.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}



const memberKey = (orgId: string, userId: string) => `tm_member_list:${orgId}:${userId}`;

export function readMemberListMemory(orgId: string, userId: string): string | null {
  try {
    return sessionStorage.getItem(memberKey(orgId, userId));
  } catch {
    return null;
  }
}

export function writeMemberListMemory(orgId: string, userId: string, query: string) {
  try {
    sessionStorage.setItem(memberKey(orgId, userId), query);
  } catch {
    /* only a convenience */
  }
}
