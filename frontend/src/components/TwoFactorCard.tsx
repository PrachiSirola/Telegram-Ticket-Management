import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { IconLock, IconCheckCircle } from "./Icons";
import { Modal } from "./Modal";

export function TwoFactorCard() {
  const [status, setStatus] = useState<{ twoFactorEnabled: boolean; hasPin: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justEnabled, setJustEnabled] = useState<boolean | null>(null); // true = enabled, false = disabled

  useEffect(() => {
    api.twoFactorStatus().then(setStatus);
  }, []);

  async function toggle() {
    if (!status) return;
    setErr(null);
    if (!status.twoFactorEnabled && !status.hasPin) {
      setErr("Set a PIN first, then enable 2FA.");
      return;
    }
    setBusy(true);
    try {
      const next = await api.toggle2fa({ enabled: !status.twoFactorEnabled, method: "PIN" });
      setStatus((s) => (s ? { ...s, twoFactorEnabled: next.twoFactorEnabled } : s));
      setJustEnabled(next.twoFactorEnabled);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't update 2FA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="eyebrow mb-4">Two-factor authentication</div>
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

      <Modal
        open={justEnabled !== null}
        onClose={() => setJustEnabled(null)}
        title={justEnabled ? "2FA enabled" : "2FA disabled"}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ok-bg text-ok">
            <IconCheckCircle size={18} />
          </div>
          <p className="pt-1.5 text-sm text-fg-soft">
            {justEnabled
              ? "You'll now be asked for your PIN each time you sign in."
              : "You'll no longer be asked for a PIN when signing in."}
          </p>
        </div>
        <button className="btn btn-primary btn-block mt-5" onClick={() => setJustEnabled(null)}>
          Got it
        </button>
      </Modal>
    </div>
  );
}