import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword({ token, password });
      await refresh(); // reset also signs you in
      navigate("/");
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't reset your password. The link may have expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-96 p-7">
        <div className="eyebrow mb-3">Ticket Management</div>
        <h1 className="text-2xl font-bold tracking-tight">Choose a new password.</h1>

        {!token ? (
          <>
            <p className="alert alert-danger mb-4 mt-4 text-sm">
              This reset link is missing its token. Please request a new one.
            </p>
            <Link to="/forgot-password" className="link text-sm">
              Request a new link
            </Link>
          </>
        ) : (
          <>
            <p className="mb-6 mt-1 text-sm text-fg-soft">
              Enter a new password for your account (min. 8 characters).
            </p>
            <form onSubmit={submit} className="grid gap-3">
              <input
                className="input"
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <input
                className="input"
                type="password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Resetting…" : "Reset password"}
              </button>
            </form>
            {err && <p className="mt-3 text-sm text-danger">{err}</p>}
            <p className="mt-4 text-center text-sm text-fg-soft">
              <Link to="/login" className="link">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
