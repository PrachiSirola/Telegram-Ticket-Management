const key = (orgId: string, projectId: string) => `tm_project_list:v2:${orgId}:${projectId}`;

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

const memberKey = (orgId: string, userId: string) => `tm_member_list:v2:${orgId}:${userId}`;

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
  }
}


const listKey = (scope: string, orgId: string, id: string) => `tm_list:v2:${scope}:${orgId}:${id}`;

export function readListMemory(scope: string, orgId: string, id = ""): string | null {
  try {
    return sessionStorage.getItem(listKey(scope, orgId, id));
  } catch {
    return null;
  }
}

export function writeListMemory(scope: string, orgId: string, id: string, query: string) {
  try {
    sessionStorage.setItem(listKey(scope, orgId, id), query);
  } catch {

  }
}

export function clearListMemory() {
  try {
    const drop: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith("tm_project_list:") || k.startsWith("tm_member_list:") || k.startsWith("tm_list:"))) drop.push(k);
    }
    drop.forEach((k) => sessionStorage.removeItem(k));
  } catch {
  }
}
