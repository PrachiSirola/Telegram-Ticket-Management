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
    // Endpoint always succeeds (it never reveals whether the email exists).
    await api.forgotPassword(email).catch(() => {});
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-96 p-7">
        <div className="eyebrow mb-3">Ticket Management</div>
        <h1 className="text-2xl font-bold tracking-tight">Reset password.</h1>

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
            <form onSubmit={submit} className="grid gap-3">
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
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
