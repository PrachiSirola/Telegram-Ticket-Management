import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { Avatar } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";
import { IconLock, IconCheckCircle } from "../components/Icons";
import { TwoFactorCard } from "../components/TwoFactorCard";
import { PinCard } from "../components/PinCard";
import { Modal } from "../components/Modal";

export default function Profile() {
  const { me, refresh } = useAuth();

  const [name, setName] = useState(me?.name ?? "");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  if (!me) return null;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameErr(null);
    setSavingName(true);
    try {
      await api.updateProfile({ name });
      await refresh();
      setNameSaved(true);
    } catch (e: any) {
      setNameErr(e?.response?.data?.error ?? "Couldn't update profile.");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(null);
    if (newPassword !== confirm) {
      setPwErr("New passwords don't match.");
      return;
    }
    setSavingPw(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setPwSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (e: any) {
      setPwErr(e?.response?.data?.error ?? "Couldn't change password.");
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={me.name} url={me.avatarUrl} size={48} />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">{me.name}</h1>
          <p className="text-sm text-muted">{me.email}</p>
        </div>
      </div>

      {/* ── 2x2 card grid: Profile / Change password / 2FA / Set PIN ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
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
              {nameErr && <span className="text-sm text-danger">{nameErr}</span>}
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
              {pwErr && <span className="text-sm text-danger">{pwErr}</span>}
            </div>
          </form>
        </div>

        <TwoFactorCard />
        <PinCard />
      </div>

      <Modal open={nameSaved} onClose={() => setNameSaved(false)} title="Profile updated">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ok-bg text-ok">
            <IconCheckCircle size={18} />
          </div>
          <p className="pt-1.5 text-sm text-fg-soft">Your profile changes have been saved successfully.</p>
        </div>
        <button className="btn btn-primary btn-block mt-5" onClick={() => setNameSaved(false)}>
          Got it
        </button>
      </Modal>

      <Modal open={pwSaved} onClose={() => setPwSaved(false)} title="Password updated">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ok-bg text-ok">
            <IconCheckCircle size={18} />
          </div>
          <p className="pt-1.5 text-sm text-fg-soft">Your password has been updated successfully.</p>
        </div>
        <button className="btn btn-primary btn-block mt-5" onClick={() => setPwSaved(false)}>
          Got it
        </button>
      </Modal>
    </div>
  );
}