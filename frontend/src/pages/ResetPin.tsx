import { failure, toast } from "../lib/toast";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { IconCheckCircle } from "../components/Icons";

export default function ResetPin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pin !== confirmPin) {
      setErr("PINs don't match.");
      toast.warning("The PINs you entered don't match.");
      return;
    }
    setBusy(true);
    try {
      await api.resetPin({ token, pin, confirmPin });
      setDone(true);
      toast.success("Your PIN was reset. You can now sign in.");
    } catch (e: any) {
      setErr(failure(e, "Couldn't reset your PIN. The link may have expired."));
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
                PIN reset successfully
              </h1>
              <p className="mb-6 mt-2 text-center text-sm text-fg-soft">
                Your PIN has been updated. Sign in and enter your new PIN when prompted.
              </p>
              <button className="btn btn-primary btn-block" onClick={() => navigate("/login")}>
                Continue to sign in
              </button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-fg">Set a new PIN</h1>

              {!token ? (
                <>
                  <p className="alert alert-danger mb-4 mt-4 text-sm">
                    This reset link is missing its token. Please request a new one.
                  </p>
                  <Link to="/login" className="link text-sm">Back to sign in</Link>
                </>
              ) : (
                <>
                  <p className="mb-6 mt-1 text-sm text-fg-soft">
                    Choose a new 6-digit PIN for two-factor sign-in.
                  </p>
                  <form onSubmit={submit} className="grid gap-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-fg-soft">New PIN</label>
                      <input
                        className="input text-center tracking-[0.3em]"
                        inputMode="numeric"
                        maxLength={6}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                        required
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-fg-soft">Confirm PIN</label>
                      <input
                        className="input text-center tracking-[0.3em]"
                        inputMode="numeric"
                        maxLength={6}
                        value={confirmPin}
                        onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                        required
                      />
                    </div>
                    <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                      {busy ? "Resetting…" : "Reset PIN"}
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