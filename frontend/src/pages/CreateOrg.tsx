import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { canCreateOrg, useAuth } from "../auth";
import { useOrg } from "../org";
import { IconCheckCircle } from "../components/Icons";

export default function CreateOrg() {
  const navigate = useNavigate();
  const { me, logout } = useAuth();
  const { orgs } = useOrg();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const firstOrg = orgs.length === 0;
  const qualifies = canCreateOrg(me);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.requestCreateOrg(name);
      setSent(true);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't send the confirmation email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center overflow-hidden rounded-2xl px-4">

      {/* Background image — no color tint, just soft blur */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: 'url(/backgroundimage.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(10px) brightness(0.8)',
          transform: 'scale(1.04)',
        }}
      />

      {/* Neutral semi-transparent overlay — no color, just darken edges */}
      <div
        className="absolute inset-0 z-[1]"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.15) 60%, rgba(0,0,0,0.1) 100%)',
        }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-md">

        {/* Brand mark */}
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-elevated"
            style={{ background: 'var(--gradient-brand)' }}
          >
            T
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-soft">
            Ticket Management
          </p>
        </div>

        {/* Glass card */}
        <div
          className="overflow-hidden rounded-2xl border border-white/30 p-8 shadow-dropdown"
          style={{
            background: 'rgba(255,255,255,0.88)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          }}
        >
          {!qualifies ? (
            <>
              <h1
                className="text-2xl font-bold tracking-tight text-fg"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                You're not in any organisation
              </h1>
              <p className="mb-0 mt-2 text-sm leading-relaxed text-fg-soft">
                Only a Super Admin can create a new organisation. Ask one to create it and invite
                you, or ask your administrator for an invite link to join an existing one.
              </p>
            </>
          ) : sent ? (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-ok">
                <IconCheckCircle size={22} />
              </div>
              <h1
                className="text-center text-2xl font-bold tracking-tight text-fg"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Check your email
              </h1>
              <p className="mb-0 mt-2 text-center text-sm leading-relaxed text-fg-soft">
                We've sent a confirmation link to <strong>{me?.email}</strong>. Open it to finish
                creating <strong>{name.trim()}</strong>. The link expires in 30 minutes.
              </p>
            </>
          ) : (
            <>
              <h1
                className="text-2xl font-bold tracking-tight text-fg"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {firstOrg ? "You're not in any organisation" : "New organisation"}
              </h1>
              <p className="mb-6 mt-2 text-sm leading-relaxed text-fg-soft">
                {firstOrg
                  ? "Create one to get started — you'll be its Super Admin. We'll email you a confirmation link before it's created."
                  : "You'll be the new organisation's Super Admin. We'll email you a confirmation link before it's created."}
              </p>

              <form onSubmit={submit} className="grid gap-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-fg-soft">
                    Organisation name
                  </label>
                  <input
                    className="input"
                    type="text"
                    placeholder="Acme Inc."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                    autoFocus
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? "Sending…" : "Send confirmation email"}
                </button>
              </form>

              {err && <p className="mt-3 text-sm text-danger">{err}</p>}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm font-medium text-fg-soft">
          {firstOrg ? (
            <>
              Signed in as {me?.email} ·{" "}
              <button
                className="font-semibold text-primary underline underline-offset-2 hover:text-primary-hover"
                onClick={() => logout()}
              >
                Log out
              </button>
            </>
          ) : (
            <button
              className="font-semibold text-primary underline underline-offset-2 hover:text-primary-hover"
              onClick={() => navigate(-1)}
            >
              {sent ? "Back" : "Cancel"}
            </button>
          )}
        </p>
      </div>
    </div>
  );
}