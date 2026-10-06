import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await api.forgotPassword(email).catch(() => {});
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "url(/backgroundimage2.jpeg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.15, filter: "blur(1.5px) saturate(1.5)" }} />
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
          <h1 className="text-2xl font-bold tracking-tight text-fg">Reset password</h1>

          {sent ? (
            <>
              <p className="alert alert-ok mb-4 mt-4 text-sm">
                If an account exists for <strong>{email}</strong>, we've sent a link to reset your
                password. Check your inbox.
              </p>
              <Link to="/login" className="link text-sm">
                ← Back to sign in
              </Link>
            </>
          ) : (
            <>
              <p className="mb-6 mt-1 text-sm text-fg-soft">
                Enter your email and we'll send you a link to choose a new password.
              </p>
              <form onSubmit={submit} className="grid gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-fg-soft">Email</label>
                  <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? "Sending…" : "Send reset link"}
                </button>
              </form>
                <p className="mt-4 text-center text-sm text-fg-soft">
                <Link to="/login" className="link">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}