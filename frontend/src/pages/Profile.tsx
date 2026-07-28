import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { Avatar } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";
import { IconLock } from "../components/Icons";

export default function Profile() {
  const { me, refresh } = useAuth();

  const [name, setName] = useState(me?.name ?? "");
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  if (!me) return null;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameMsg(null);
    setSavingName(true);
    try {
      await api.updateProfile({ name });
      await refresh();
      setNameMsg({ ok: true, text: "Profile updated." });
    } catch (e: any) {
      setNameMsg({ ok: false, text: e?.response?.data?.error ?? "Couldn't update profile." });
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword !== confirm) {
      setPwMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setSavingPw(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setPwMsg({ ok: true, text: "Password changed." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (e: any) {
      setPwMsg({ ok: false, text: e?.response?.data?.error ?? "Couldn't change password." });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={me.name} url={me.avatarUrl} size={48} />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">{me.name}</h1>
          <p className="text-sm text-muted">{me.email}</p>
        </div>
      </div>

      <div className="card mb-5 p-6">
        <div className="eyebrow mb-4">Profile</div>
        <form onSubmit={saveName} className="grid gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">Display name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">Email</label>
            <div className="relative">
              <input className="input pr-10 bg-accent/50 text-muted cursor-not-allowed" value={me.email} disabled />
              <IconLock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            </div>
            <p className="mt-1 text-xs text-muted">Email cannot be changed</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={savingName}>
              {savingName ? "Saving…" : "Save changes"}
            </button>
            {nameMsg && (
              <span className={`text-sm ${nameMsg.ok ? "text-ok" : "text-danger"}`}>
                {nameMsg.text}
              </span>
            )}
          </div>
        </form>
      </div>

      <div className="card p-6">
        <div className="eyebrow mb-4">Change password</div>
        <form onSubmit={savePassword} className="grid gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">Current password</label>
            <PasswordInput className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">New password</label>
            <PasswordInput className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">Confirm new password</label>
            <PasswordInput className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={savingPw}>
              {savingPw ? "Saving…" : "Update password"}
            </button>
            {pwMsg && (
              <span className={`text-sm ${pwMsg.ok ? "text-ok" : "text-danger"}`}>
                {pwMsg.text}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}