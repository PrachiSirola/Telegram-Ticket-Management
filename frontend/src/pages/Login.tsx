import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../auth";

export default function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const { data: config } = useQuery({ queryKey: ["authConfig"], queryFn: api.authConfig });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Legacy invite links pointed at /login?invite=<token>; send them to the
  // dedicated account-setup page.
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-96 p-7">
        <div className="eyebrow mb-3">Ticket Management</div>
        <h1 className="text-2xl font-bold tracking-tight">Sign in.</h1>
        <p className="mb-6 mt-1 text-sm text-fg-soft">
          Welcome back to your organisation's tickets.
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
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

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

        <p className="mt-5 text-center text-sm text-fg-soft">
          New here?{" "}
          <Link to="/signup" className="link">
            Create an organisation
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-fg-soft">
          Joining an existing organisation? Use the invite link from your administrator.
        </p>
      </div>
    </div>
  );
}
