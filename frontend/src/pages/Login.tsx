import { failure, toast } from "../lib/toast";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { PasswordInput } from "../components/PasswordInput";
import { Modal } from "../components/Modal";

export default function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const { data: config } = useQuery({ queryKey: ["authConfig"], queryFn: api.authConfig });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<"password" | "pin">("password");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const inviteToken = params.get("invite");
  useEffect(() => {
    if (inviteToken) navigate(`/accept-invite?token=${inviteToken}`, { replace: true });
  }, [inviteToken, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const result = await api.login({ email, password });
      if (result.requires2fa) {
        setStage("pin");
      } else {
        await refresh();
        navigate("/");
      }
    } catch (e: any) {
      setErr(failure(e, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.verify2fa(pin);
      await refresh();
      navigate("/");
    } catch (e: any) {
      setErr(failure(e, "Incorrect PIN."));
    } finally {
      setBusy(false);
    }
  }

  async function sendForgotPin() {
    setForgotBusy(true);
    setErr(null);
    try {
      await api.forgotPin();
      setForgotSent(true);
      toast.success("PIN reset email sent. Check your inbox.");
    } catch (e: any) {
      setErr(failure(e, "Couldn't send reset email."));
    } finally {
      setForgotBusy(false);
    }
  }

  function backToPassword() {
    setStage("password");
    setPin("");
    setErr(null);
    setForgotSent(false);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "url(/backgroundimage.jpeg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.05, filter: "blur(2px) saturate(0.5)" }} />
      <div className="relative z-10 w-full max-w-sm">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-bold text-white"
            style={{ background: 'var(--gradient-brand)' }}
          >
            T
          </div>
          <div className="eyebrow">Ticket Management</div>
        </div>

        {stage === "password" ? (
          <div className="card p-8">
            <h1 className="text-2xl font-bold tracking-tight text-fg">Sign in</h1>
            <p className="mb-6 mt-1 text-sm text-fg-soft">
              Welcome back to your organisation's tickets.
            </p>

            <form onSubmit={submit} className="grid gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg-soft">Email</label>
                <input
                  className="input"
                  type="email"
                  placeholder="Enter your email..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg-soft">Password</label>
                <PasswordInput
                  className="input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              {config?.passwordReset && (
                <div className="-mt-1 text-right">
                  <Link to="/forgot-password" className="link text-sm">
                    Forgot password?
                  </Link>
                </div>
              )}

              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Please wait…" : "Sign in"}
              </button>
            </form>

            {err && <p className="mt-3 text-sm text-danger">{err}</p>}
          </div>
        ) : (
          <div className="card p-8">
            <h1 className="text-2xl font-bold tracking-tight text-fg">Enter your PIN</h1>
            <p className="mb-6 mt-1 text-sm text-fg-soft">
              Passkey authentication is enabled for this account.
            </p>

            <form onSubmit={submitPin} className="grid gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg-soft">6-digit PIN</label>
                <input
                  className="input text-center tracking-[0.3em]"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                />
              </div>

              <div className="-mt-1 text-right">
              <button type="button" className="link text-sm" onClick={sendForgotPin} disabled={forgotBusy}>
                {forgotBusy ? "Sending…" : "Forgot PIN?"}
              </button>
              </div>

              <Modal open={forgotSent} onClose={() => setForgotSent(false)} title="Check your email">
              <p className="text-sm text-fg-soft">
                If an account matches, we've sent a link to reset your 2FA PIN to your inbox. The link expires in 1 hour.
              </p>
              <button
                type="button"
                className="btn btn-primary btn-block mt-5"
                onClick={() => setForgotSent(false)}
              >
                Got it
              </button>
            </Modal>

              <button type="submit" className="btn btn-primary btn-block" disabled={busy || pin.length !== 6}>
                {busy ? "Verifying…" : "Verify"}
              </button>
              <button type="button" className="btn btn-secondary btn-block" onClick={backToPassword} disabled={busy}>
                Back
              </button>
            </form>

            {err && <p className="mt-3 text-sm text-danger">{err}</p>}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-muted">
          Joining an existing organisation? Use the invite link from your administrator.
        </p>
      </div>
    </div>
  );
}