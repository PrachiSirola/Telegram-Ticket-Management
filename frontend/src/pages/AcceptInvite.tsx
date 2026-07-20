import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../auth";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me, refresh, logout } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const {
    data: invite,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.inviteInfo(token),
    enabled: !!token,
    retry: false,
  });

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish() {
    await refresh();
    await qc.invalidateQueries({ queryKey: ["orgs"] });
    navigate("/");
  }

  // New account: register with token.
  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await api.register({ token, name, password });
      await finish();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't create your account. The link may have expired.");
    } finally {
      setBusy(false);
    }
  }

  // Existing account, logged out: sign in, then accept.
  async function submitLoginAccept(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.login({ email: invite!.email, password: loginPassword });
      await api.acceptInvite(token);
      await finish();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  // Already logged in as the invited email: one-click accept.
  async function submitAccept() {
    setErr(null);
    setBusy(true);
    try {
      await api.acceptInvite(token);
      await finish();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't accept the invite.");
    } finally {
      setBusy(false);
    }
  }

  const invalid = !token || isError;
  const emailMismatch =
    me && invite && me.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-96 p-7">
        <div className="eyebrow mb-3">Ticket Management</div>
        <h1 className="text-2xl font-bold tracking-tight">Join {invite?.orgName ?? "the team"}.</h1>

        {invalid ? (
          <>
            <p className="alert alert-danger mb-4 mt-4 text-sm">
              This invite link is invalid or has expired. Ask your administrator for a new one.
            </p>
            <Link to="/login" className="link text-sm">
              ← Back to sign in
            </Link>
          </>
        ) : isLoading || !invite ? (
          <p className="mt-4 text-sm text-fg-soft">Checking your invite…</p>
        ) : (
          <>
            <p className="mb-5 mt-1 text-sm text-fg-soft">
              You've been invited to <strong>{invite.orgName}</strong> as{" "}
              <strong>{invite.role.toLowerCase()}</strong>
              {invite.projectNames.length > 0 && (
                <> on {invite.projectNames.join(", ")}</>
              )}
              .
            </p>

            {me ? (
              emailMismatch ? (
                <>
                  <p className="alert alert-danger mb-4 text-sm">
                    This invite is for <strong>{invite.email}</strong>, but you're signed in as{" "}
                    <strong>{me.email}</strong>.
                  </p>
                  <button
                    className="btn btn-secondary btn-block"
                    onClick={async () => {
                      await logout();
                    }}
                  >
                    Log out and switch accounts
                  </button>
                </>
              ) : (
                <button className="btn btn-primary btn-block" disabled={busy} onClick={submitAccept}>
                  {busy ? "Joining…" : `Join ${invite.orgName}`}
                </button>
              )
            ) : invite.accountExists ? (
              <form onSubmit={submitLoginAccept} className="grid gap-3">
                <p className="text-sm text-fg-soft">
                  You already have an account — sign in to accept.
                </p>
                <label className="grid gap-1 text-sm">
                  <span className="text-fg-soft">Email</span>
                  <input className="input" value={invite.email} disabled />
                </label>
                <input
                  className="input"
                  type="password"
                  placeholder="Password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in & join"}
                </button>
              </form>
            ) : (
              <form onSubmit={submitRegister} className="grid gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-fg-soft">Email</span>
                  <input className="input" value={invite.email} disabled />
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
                <input
                  className="input"
                  type="password"
                  placeholder="Password (min. 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <input
                  className="input"
                  type="password"
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
                <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? "Creating account…" : "Create account & join"}
                </button>
              </form>
            )}

            {err && <p className="mt-3 text-sm text-danger">{err}</p>}
            {!me && (
              <p className="mt-4 text-center text-sm text-fg-soft">
                <Link to="/login" className="link">
                  Back to sign in
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
