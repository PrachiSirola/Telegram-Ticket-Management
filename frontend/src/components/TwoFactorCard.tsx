import { apiError, toast } from "../lib/toast";
import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { IconLock } from "./Icons";

export function TwoFactorCard() {
  const [status, setStatus] = useState<{ twoFactorEnabled: boolean; hasPin: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.twoFactorStatus().then(setStatus);
  }, []);

  async function toggle() {
    if (!status) return;
    setErr(null);
    if (!status.twoFactorEnabled && !status.hasPin) {
      setErr("Set a PIN first, then enable 2FA.");
      toast.warning("Register a passkey first to enable secure sign-in.");
      return;
    }
    setBusy(true);
    try {
      const next = await api.toggle2fa({ enabled: !status.twoFactorEnabled, method: "PIN" });
      setStatus((s) => (s ? { ...s, twoFactorEnabled: next.twoFactorEnabled } : s));
      toast.success(
        next.twoFactorEnabled
          ? "Passkey authentication is enabled. You'll use your passkey each time you sign in."
          : "Passkey authentication disabled. You'll no longer be asked for a passkey when signing in.",
      );
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? "Couldn't update passkey authentication.";
      setErr(msg);
      toast.error(apiError(e, msg), { title: "Couldn't update passkey authentication" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="eyebrow mb-4">Passkey authentication</div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-fg-soft">
          <IconLock size={16} />
          {status?.twoFactorEnabled ? "Enabled — PIN required at login" : "Disabled"}
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy || !status}
          className={`btn btn-sm ${status?.twoFactorEnabled ? "btn-danger" : "btn-primary"}`}
        >
          {status?.twoFactorEnabled ? "Disable" : "Enable"}
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </div>
  );
}