import { failure, toast } from "../lib/toast";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { PasswordInput } from "../components/PasswordInput";

export default function Signup() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [step, setStep] = useState<"form" | "otp">("form");
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirmPw) {
      setErr("Passwords don't match.");
      toast.warning("The passwords you entered don't match.");
      return;
    }
    setBusy(true);
    try {
      await api.signup({ orgName, name, email, password });
      setStep("otp");
      toast.info(`Verification code sent to ${email}.`);
      setInfo(`We sent a 6-digit code to ${email}.`);
    } catch (e: any) {
      setErr(failure(e, "Something went wrong. Please try again."));
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
      toast.success(`Account created. Welcome to ${orgName || "your new workspace"}!`);
      navigate("/");
    } catch (e: any) {
      setErr(failure(e, "Verification failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setErr(null);
    try {
      await api.resendSignupOtp(email);
      setInfo(`A new code is on its way to ${email}.`);
      toast.success(`A new verification code was sent to ${email}.`);
    } catch (e: any) {
      setErr(failure(e, "Couldn't resend the code."));
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "url(/backgroundimage2.jpeg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.05, filter: "blur(2px) saturate(0.5)" }} />
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
          {step === "form" ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-fg">Create your organisation</h1>
              <p className="mb-6 mt-1 text-sm text-fg-soft">
                You'll be the organisation's Super Admin.
              </p>
              <form onSubmit={submitForm} className="grid gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-fg-soft">Organisation name</label>
                  <input className="input" type="text" placeholder="Acme Inc." value={orgName} onChange={(e) => setOrgName(e.target.value)} required maxLength={100} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-fg-soft">Full name</label>
                  <input className="input" type="text" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-fg-soft">Email</label>
                  <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-fg-soft">Password</label>
                  <PasswordInput className="input" placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-fg-soft">Confirm password</label>
                  <PasswordInput className="input" placeholder="Re-enter password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required minLength={8} autoComplete="new-password" />
                </div>
                <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? "Sending code…" : "Continue"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-fg">Check your email</h1>
              <p className="mb-6 mt-1 text-sm text-fg-soft">{info}</p>
              <form onSubmit={submitOtp} className="grid gap-4">
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
                <button className="link" onClick={resend}>Resend code</button>
                {" · "}
                <button className="link" onClick={() => { setStep("form"); setErr(null); }}>
                  Edit details
                </button>
              </p>
            </>
          )}

          {err && <p className="mt-3 text-sm text-danger">{err}</p>}
        </div>

        <p className="mt-6 text-center text-sm text-fg-soft">
          Already have an account?{" "}
          <Link to="/login" className="link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}