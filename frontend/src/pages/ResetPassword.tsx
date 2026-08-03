import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { PasswordInput } from "../components/PasswordInput";
import { IconCheckCircle } from "../components/Icons";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { me, logout } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // If this link is opened in a browser that still has an active session
  // (e.g. the user was already signed in elsewhere), clear it — resetting
  // a password should always lead to a fresh sign-in, not silently reuse
  // whatever session happened to be active.
  useEffect(() => {
    if (me) logout();
  }, [me, logout]);

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
      setDone(true);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't reset your password. The link may have expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "url(/backgroundimage.jpeg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.05, filter: "blur(2px) saturate(0.5)" }} />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-bold text-white"
            style={{ background: 'var(--gradient-brand)' }}
          >
            T
          </div>
          <div className="eyebrow">Ticket Management</div>
        </div>

        <div className="card p-8">
          {done ? (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-ok">
                <IconCheckCircle size={22} />
              </div>
              <h1 className="text-center text-2xl font-bold tracking-tight text-fg">
                Password reset successfully
              </h1>
              <p className="mb-6 mt-2 text-center text-sm text-fg-soft">
                Your password has been updated. Sign in with your new password to continue.
              </p>
              <button
                className="btn btn-primary btn-block"
                onClick={() => navigate("/login")}
              >
                Continue to sign in
              </button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-fg">Choose a new password</h1>

              {!token ? (
                <>
                  <p className="alert alert-danger mb-4 mt-4 text-sm">
                    This reset link is missing its token. Please request a new one.
                  </p>
                  <Link to="/forgot-password" className="link text-sm">Request a new link</Link>
                </>
              ) : (
                <>
                  <p className="mb-6 mt-1 text-sm text-fg-soft">
                    Enter a new password for your account (min. 8 characters).
                  </p>
                  <form onSubmit={submit} className="grid gap-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-fg-soft">New password</label>
                      <PasswordInput className="input" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-fg-soft">Confirm password</label>
                      <PasswordInput className="input" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
                    </div>
                    <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                      {busy ? "Resetting…" : "Reset password"}
                    </button>
                  </form>
                  {err && <p className="mt-3 text-sm text-danger">{err}</p>}
                  <p className="mt-4 text-center text-sm text-fg-soft">
                    <Link to="/login" className="link">Back to sign in</Link>
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}