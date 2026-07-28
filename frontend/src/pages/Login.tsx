import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../auth";
//import { PasswordInput } from "../components/PasswordInput";

export default function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const { data: config } = useQuery({ queryKey: ["authConfig"], queryFn: api.authConfig });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inviteToken = params.get("invite");
  useEffect(() => {
    if (inviteToken) navigate(`/accept-invite?token=${inviteToken}`, { replace: true });
  }, [inviteToken, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.login({ email, password });
      await refresh();
      navigate("/");
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "url(/backgroundimage2.jpeg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.05, filter: "blur(2px) saturate(0.5)" }} />
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
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg-soft">Password</label>
              <input
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

        <p className="mt-6 text-center text-sm text-fg-soft">
          New here?{" "}
          <Link to="/signup" className="link">
            Create an organisation
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted">
          Joining an existing organisation? Use the invite link from your administrator.
        </p>
      </div>
    </div>
  );
}