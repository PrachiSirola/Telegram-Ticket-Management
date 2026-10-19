import { apiError, toast } from "../lib/toast";
import { useState } from "react";
import { api } from "../lib/api";
import { useTwoFactorStatus } from "../lib/twoFactorStatus";
import { PasswordInput } from "./PasswordInput";
import { IconCheckCircle } from "./Icons";

export function PinCard() {
  const { status, patch, error: statusError } = useTwoFactorStatus();
  const [changing, setChanging] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasPin = !!status?.hasPin;

  function reset() {
    setCurrentPassword("");
    setPin("");
    setConfirmPin("");
    setErr(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.setPin({ currentPassword, pin, confirmPin });
      toast.success(hasPin ? "Your PIN has been changed. Use the new PIN the next time you sign in." : "Your PIN has been saved. Use it the next time you sign in.");
      patch({ hasPin: true }); // the "PIN is already set." view and the Enable button update straight away
      reset();
      setChanging(false);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? "Couldn't set PIN.";
      setErr(msg);
      toast.error(apiError(e, msg), { title: "Couldn't set the PIN" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="eyebrow mb-4">Register Passkey</div>
      {!status ? (
        <p className="text-sm text-muted" data-testid="pin-status-loading">
          {statusError ? "Couldn't load your PIN status." : "Loading…"}
        </p>
      ) : hasPin && !changing ? (
        <div className="flex items-center justify-between gap-3" data-testid="pin-already-set">
          <div className="flex items-center gap-2 text-sm text-fg-soft">
            <IconCheckCircle size={16} />
            PIN is already set.
          </div>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="change-pin" onClick={() => setChanging(true)}>
            Change PIN
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">6-digit PIN</label>
            <input
              className="input tracking-[0.3em]"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">Confirm PIN</label>
            <input
              className="input tracking-[0.3em]"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">Current password</label>
            <PasswordInput className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save PIN"}
            </button>
            {hasPin && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => {
                  reset();
                  setChanging(false);
                }}
              >
                Cancel
              </button>
            )}
            {err && <span className="text-sm text-danger">{err}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
