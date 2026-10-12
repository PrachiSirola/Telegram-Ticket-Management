import { apiError, toast } from "../lib/toast";
import { useState } from "react";
import { api } from "../lib/api";
import { PasswordInput } from "./PasswordInput";

export function PinCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.setPin({ currentPassword, pin, confirmPin });
      toast.success("Your passkey has been registered successfully. Use it the next time you sign in.");
      setCurrentPassword("");
      setPin("");
      setConfirmPin("");
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
    </div>
  );
}