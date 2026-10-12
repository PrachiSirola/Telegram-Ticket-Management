import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { rememberJoinedOrg } from "../org";
import { PasswordInput } from "../components/PasswordInput";

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
    // Land in the organisation this invite belongs to, not whichever one was open before.
    if (invite?.orgId) rememberJoinedOrg(invite.orgId);
    await refresh();
    await qc.invalidateQueries({ queryKey: ["orgs"] });
    navigate("/");
  }

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
          <h1 className="text-2xl font-bold tracking-tight text-fg">Join {invite?.orgName ?? "the team"}</h1>

          {invalid ? (
            <>
              <p className="alert alert-danger mb-4 mt-4 text-sm">
                This invite link is invalid or has expired. Ask your administrator for a new one.
              </p>
              <Link to="/login" className="link text-sm">← Back to sign in</Link>
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
                )}.
              </p>

              {me ? (
                emailMismatch ? (
                  <>
                    <p className="alert alert-danger mb-4 text-sm">
                      This invite is for <strong>{invite.email}</strong>, but you're signed in as{" "}
                      <strong>{me.email}</strong>.
                    </p>
                    <button className="btn btn-secondary btn-block" onClick={async () => { await logout(); }}>
                      Log out and switch accounts
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={submitAccept}>
                    {busy ? "Joining…" : `Join ${invite.orgName}`}
                  </button>
                )
              ) : invite.accountExists ? (
                <form onSubmit={submitLoginAccept} className="grid gap-4">
                  <p className="text-sm text-fg-soft">
                    You already have an account — sign in to accept.
                  </p>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-fg-soft">Email</label>
                    <input className="input" value={invite.email} disabled />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-fg-soft">Password</label>
                    <PasswordInput className="input" placeholder="••••••••" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required autoComplete="current-password" />
                  </div>
                  <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in & join"}
                  </button>
                </form>
              ) : (
                <form onSubmit={submitRegister} className="grid gap-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-fg-soft">Email</label>
                    <input className="input" value={invite.email} disabled />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-fg-soft">Full name</label>
                    <input className="input" type="text" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-fg-soft">Password</label>
                    <PasswordInput className="input" placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-fg-soft">Confirm password</label>
                    <PasswordInput className="input" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
                  </div>
                  <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                    {busy ? "Creating account…" : "Create account & join"}
                  </button>
                </form>
              )}

              {err && <p className="mt-3 text-sm text-danger">{err}</p>}
              {!me && (
                <p className="mt-4 text-center text-sm text-fg-soft">
                  <Link to="/login" className="link">Back to sign in</Link>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}