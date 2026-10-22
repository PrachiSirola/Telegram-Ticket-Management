import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { listQuery, readListMemory, writeListMemory } from "./projectListMemory";

export function useListViewMemory({
  scope,
  orgId,
  id = "",
  keys,
  defaultView = "",
}: {
  scope: string;
  orgId: string;
  id?: string;

  keys: readonly string[];
  
  defaultView?: string;
}): boolean {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const [readyFor, setReadyFor] = useState("");
  const token = `${orgId}|${id}`;
  const pending = useRef<string | null>(null);

  useEffect(() => {
    if (!orgId || readyFor === token) return;
    const urlHasView = keys.some((k) => params.get(k));
    if (!urlHasView) {
      const remembered = readListMemory(scope, orgId, id);
      const view = remembered ?? defaultView;
      if (view !== "") {
        const saved = new URLSearchParams(view);
        const next = new URLSearchParams(params);
        for (const k of keys) {
          const v = saved.get(k);
          if (v) next.set(k, v);
          else next.delete(k);
        }
        pending.current = listQuery(next, keys, keys[0]);
        setParams(next, { replace: true, state }); 
      }
    }
    setReadyFor(token);
   
  }, [orgId, id, token, readyFor]);

  const current = listQuery(params, keys, keys[0]);
  useEffect(() => {
    if (!orgId || readyFor !== token) return;
    if (pending.current !== null) {
      if (current !== pending.current) return;
      pending.current = null;
    }
    writeListMemory(scope, orgId, id, current);
  }, [scope, orgId, id, token, readyFor, current]);

  return !!orgId && readyFor === token;
}
