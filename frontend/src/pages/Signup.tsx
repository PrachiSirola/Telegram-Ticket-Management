import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth";

export default function Signup() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [step, setStep] = useState<"form" | "otp">("form");
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.signup({ orgName, name, email, password });
      setStep("otp");
      setInfo(`We sent a 6-digit code to ${email}.`);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.verifySignup({ email, code });
      await refresh();
      navigate("/");
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Verification failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setErr(null);
    try {
      await api.resendSignupOtp(email);
      setInfo(`A new code is on its way to ${email}.`);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't resend the code.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-96 p-7">
        <div className="eyebrow mb-3">Ticket Management</div>

        {step === "form" ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Create your organisation.</h1>
            <p className="mb-6 mt-1 text-sm text-fg-soft">
              You'll be the organisation's Super Admin.
            </p>
            <form onSubmit={submitForm} className="grid gap-3">
              <input
                className="input"
                type="text"
                placeholder="Organisation name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
                maxLength={100}
              />
              <input
                className="input"
                type="text"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
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
                placeholder="Password (min. 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Sending code…" : "Continue"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Check your email.</h1>
            <p className="mb-6 mt-1 text-sm text-fg-soft">{info}</p>
            <form onSubmit={submitOtp} className="grid gap-3">
              <input
                className="input text-center text-2xl tracking-[0.5em]"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
              />
              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={busy || code.length !== 6}
              >
                {busy ? "Verifying…" : "Verify & create organisation"}
              </button>
            </form>
            <p className="mt-4 text-center text-sm text-fg-soft">
              Didn't get it?{" "}
              <button className="link" onClick={resend}>
                Resend code
              </button>
              {" · "}
              <button
                className="link"
                onClick={() => {
                  setStep("form");
                  setErr(null);
                }}
              >
                Edit details
              </button>
            </p>
          </>
        )}

        {err && <p className="mt-3 text-sm text-danger">{err}</p>}

        <p className="mt-5 text-center text-sm text-fg-soft">
          Already have an account?{" "}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
