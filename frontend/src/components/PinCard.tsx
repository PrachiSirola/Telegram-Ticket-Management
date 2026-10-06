import { useState } from "react";
import { api } from "../lib/api";
import { PasswordInput } from "./PasswordInput";
import { IconCheckCircle } from "./Icons";
import { Modal } from "./Modal";

export function PinCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.setPin({ currentPassword, pin, confirmPin });
      setSaved(true);
      setCurrentPassword("");
      setPin("");
      setConfirmPin("");
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't set PIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="eyebrow mb-4">Set 2FA PIN</div>
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
          {err && <span className="text-sm text-danger">{err}</span>}
        </div>
      </form>

      <Modal open={saved} onClose={() => setSaved(false)} title="PIN set successfully">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ok-bg text-ok">
            <IconCheckCircle size={18} />
          </div>
          <p className="pt-1.5 text-sm text-fg-soft">Your 2FA PIN has been set. Use it the next time you sign in.</p>
        </div>
        <button className="btn btn-primary btn-block mt-5" onClick={() => setSaved(false)}>
          Got it
        </button>
      </Modal>
    </div>
  );
}