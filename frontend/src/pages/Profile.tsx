import { apiError, q, toast } from "../lib/toast";
import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { Avatar } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";
import { IconLock } from "../components/Icons";
import { TwoFactorCard } from "../components/TwoFactorCard";
import { AuthenticatorCard } from "../components/AuthenticatorCard";
import { PinCard } from "../components/PinCard";

export default function Profile() {
  const { me, refresh } = useAuth();

  const [name, setName] = useState(me?.name ?? "");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  if (!me) return null;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameErr(null);
    setSavingName(true);
    try {
      const before = me!.name;
      const after = name.trim();
      await api.updateProfile({ name });
      await refresh();
      if (after === before) toast.info("Your display name is unchanged.");
      else toast.success(`Display name changed from ${q(before)} to ${q(after)}.`);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? "Couldn't update profile.";
      setNameErr(msg);
      toast.error(apiError(e, msg), { title: "Couldn't update your profile" });
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(null);
    if (newPassword !== confirm) {
      setPwErr("New passwords don't match.");
      toast.warning("The new password and its confirmation don't match.");
      return;
    }
    setSavingPw(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      toast.success("Your password was changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? "Couldn't change password.";
      setPwErr(msg);
      toast.error(apiError(e, msg), { title: "Couldn't change your password" });
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

        {/* Passkey column: Register Passkey, with the Enable/Disable control directly below it. */}
        <div className="flex flex-col gap-6">
          <PinCard />
          <TwoFactorCard />
        </div>
        <AuthenticatorCard />
      </div>
    </div>
  );
}