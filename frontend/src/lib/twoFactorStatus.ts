import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface TwoFactorStatus {
  twoFactorEnabled: boolean;
  twoFactorMethod: "PIN" | "PASSKEY" | null;
  hasPin: boolean;
}
const KEY = ["twoFactorStatus"] as const;

export function useTwoFactorStatus() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.twoFactorStatus(), staleTime: 0 });
  const patch = (changes: Partial<TwoFactorStatus>) =>
    qc.setQueryData<TwoFactorStatus>(KEY, (old) => (old ? { ...old, ...changes } : old));
  return { status: q.data ?? null, loading: q.isLoading, error: q.isError, patch };
}
