import { apiError, toast } from "../lib/toast";
import { useState } from "react";
import { api } from "../lib/api";
import { useTwoFactorStatus } from "../lib/twoFactorStatus";
import { IconLock } from "./Icons";
import { Modal } from "./Modal";
import { PasswordInput } from "./PasswordInput";

export function TwoFactorCard() {
  const { status, patch } = useTwoFactorStatus();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modalErr, setModalErr] = useState<string | null>(null);

  const enabling = !status?.twoFactorEnabled;

  function start() {
    if (!status) return;
    setErr(null);
    if (!status.twoFactorEnabled && !status.hasPin) {
      setErr("Set a PIN first, then enable PIN authentication.");
      toast.warning("Register a PIN first to enable secure sign-in.");
      return;
    }
    setPassword("");
    setModalErr(null);
    setAsking(true);
  }

  function close() {
    if (busy) return;
    setAsking(false);
    setPassword(""); 
    setModalErr(null);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!status) return;
    setBusy(true);
    setModalErr(null);
    try {
      const next = await api.toggle2fa({ enabled: !status.twoFactorEnabled, method: "PIN", currentPassword: password });
      patch({ twoFactorEnabled: next.twoFactorEnabled, twoFactorMethod: next.twoFactorMethod });
      setAsking(false);
      setPassword("");
      toast.success(
        next.twoFactorEnabled
          ? "PIN authentication is enabled. You'll enter your PIN each time you sign in."
          : "PIN authentication disabled. You'll no longer be asked for a PIN when signing in.",
      );
    } catch (e: any) {
      setModalErr(apiError(e, "Couldn't update PIN authentication."));
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
          onClick={start}
          disabled={busy || !status}
          data-testid="pin-auth-toggle"
          className={`btn btn-sm ${status?.twoFactorEnabled ? "btn-danger" : "btn-primary"}`}
        >
          {status?.twoFactorEnabled ? "Disable" : "Enable"}
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}

      <Modal open={asking} onClose={close} title={enabling ? "Enable PIN authentication" : "Disable PIN authentication"} width={460}>
        <form onSubmit={confirm} className="space-y-4">
          <p className="text-sm text-fg-soft">
            {enabling
              ? "For your security, confirm your password to turn on PIN authentication."
              : "For your security, confirm your password to turn off PIN authentication. Your saved PIN is kept."}
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft" htmlFor="pin-toggle-pw">
              Current password
            </label>
            <PasswordInput
              id="pin-toggle-pw"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
            />
          </div>
          {modalErr && (
            <p className="text-sm text-danger" role="alert" data-testid="pin-toggle-error">
              {modalErr}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={`btn btn-sm ${enabling ? "btn-primary" : "btn-danger"}`} disabled={busy || !password} data-testid="pin-toggle-confirm">
              {busy ? "Checking…" : enabling ? "Enable" : "Disable"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
