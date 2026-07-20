import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { Avatar } from "../components/ui";

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
      <div className="mb-6 flex items-center gap-3">
        <Avatar name={me.name} url={me.avatarUrl} size={44} />
        <div>
          <h1 className="text-xl font-bold tracking-tight">{me.name}</h1>
          <p className="text-sm text-fg-soft">{me.email}</p>
        </div>
      </div>

      {/* Profile details */}
      <div className="card mb-5 p-6">
        <div className="eyebrow mb-3">Profile</div>
        <form onSubmit={saveName} className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-fg-soft">Display name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-fg-soft">Email</span>
            <input className="input" value={me.email} disabled />
          </label>
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

      {/* Change password */}
      <div className="card p-6">
        <div className="eyebrow mb-3">Change password</div>
        <form onSubmit={savePassword} className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-fg-soft">Current password</span>
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-fg-soft">New password</span>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-fg-soft">Confirm new password</span>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
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
