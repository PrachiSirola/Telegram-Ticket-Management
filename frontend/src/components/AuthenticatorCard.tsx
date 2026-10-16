import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, type AuthenticatorStatus } from "../lib/api";
import { apiError, toast } from "../lib/toast";
import { Modal } from "./Modal";
import { PasswordInput } from "./PasswordInput";
import { IconCheck, IconLock } from "./Icons";

type Step =
  | { kind: "idle" }
  | { kind: "password"; purpose: "setup" | "disable" }
  | { kind: "scan"; secret: string; otpauthUrl: string };

export function AuthenticatorCard() {
  const [status, setStatus] = useState<AuthenticatorStatus | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });

  const load = useCallback(() => api.authenticatorStatus().then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => {
    load();
  }, [load]);

  const close = () => setStep({ kind: "idle" });

  return (
    <div className="card p-6">
      <div className="eyebrow mb-4">Two-Factor Authentication (2FA)</div>
      <p className="mb-4 text-sm text-fg-soft">
        2FA adds an additional verification method for account recovery when your passkey isn't available. Your
        existing passkey login stays exactly as it is — you'll find this under <b>Try another way</b> on the sign-in
        screen.
      </p>

      {!status ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !status.configured ? (
        <Notice>Authenticator apps aren't available on this server yet. Ask your administrator to enable them.</Notice>
      ) : !status.enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-fg-soft">
            <IconLock size={16} />
            {status.hasPin ? "Authenticator app: not set up" : "Register a passkey first to set up 2FA"}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!status.hasPin}
            onClick={() => setStep({ kind: "password", purpose: "setup" })}
          >
            Set up authenticator
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-fg-soft">
              <IconCheck size={16} />
              Authenticator app: enabled
            </div>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setStep({ kind: "password", purpose: "disable" })}
            >
              Disable 2FA
            </button>
          </div>
        </div>
      )}

      <Modal
        open={step.kind !== "idle"}
        onClose={close}
        title={
          step.kind === "password"
            ? step.purpose === "setup"
              ? "Set up authenticator app"
              : "Disable 2FA"
            : "Scan the QR code"
        }
        width={460}
      >
        {step.kind === "password" && (
          <PasswordStep
            purpose={step.purpose}
            onCancel={close}
            onDone={(next) => {
              setStep(next);
              load();
            }}
          />
        )}
        {step.kind === "scan" && (
          <ScanStep
            secret={step.secret}
            otpauthUrl={step.otpauthUrl}
            onCancel={close}
            onEnabled={() => {
              toast.success("Authenticator app enabled.");
              close();
              load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-surface px-3 py-2 text-sm text-fg-soft">{children}</p>;
}

function PasswordStep({
  purpose,
  onCancel,
  onDone,
}: {
  purpose: "setup" | "disable";
  onCancel: () => void;
  onDone: (next: Step) => void;
}) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (purpose === "setup") {
        const r = await api.authenticatorSetup(pw);
        onDone({ kind: "scan", secret: r.secret, otpauthUrl: r.otpauthUrl });
      } else {
        await api.authenticatorDisable(pw);
        toast.success("2FA disabled. Your passkey login is unchanged.");
        onDone({ kind: "idle" });
      }
    } catch (e: any) {
      setErr(apiError(e, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-fg-soft">
        {purpose === "disable"
          ? "This removes the authenticator app. Your passkey login isn't affected."
          : "For your security, confirm your password before linking an authenticator app."}
      </p>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-fg-soft" htmlFor="auth-pw">
          Current password
        </label>
        <PasswordInput
          id="auth-pw"
          autoFocus
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full"
        />
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={`btn btn-sm ${purpose === "disable" ? "btn-danger" : "btn-primary"}`}
          disabled={busy || !pw}
        >
          {busy ? "Checking…" : purpose === "disable" ? "Disable 2FA" : "Continue"}
        </button>
      </div>
    </form>
  );
}

function ScanStep({
  secret,
  otpauthUrl,
  onCancel,
  onEnabled,
}: {
  secret: string;
  otpauthUrl: string;
  onCancel: () => void;
  onEnabled: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(otpauthUrl, { margin: 1, width: 192, errorCorrectionLevel: "M" })
      .then((u) => alive && setQr(u))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [otpauthUrl]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.authenticatorEnable(code);
      onEnabled();
    } catch (e: any) {
      setErr(apiError(e, "That code didn't work. Check the code and try again."));
    } finally {
      setBusy(false);
    }
  }

  const spaced = secret.replace(/(.{4})/g, "$1 ").trim();

  return (
    <form onSubmit={submit} className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-soft">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
        <li>Scan this QR code, or enter the key manually.</li>
        <li>Type the 6-digit code the app shows to finish.</li>
      </ol>
      <div className="flex flex-col items-center gap-2">
        {qr ? (
          <img src={qr} alt="QR code to add this account to your authenticator app" width={192} height={192} className="rounded-lg border border-card-border" />
        ) : (
          <div className="flex h-48 w-48 items-center justify-center rounded-lg border border-card-border text-xs text-muted">
            QR code unavailable — use the key below
          </div>
        )}
        <div className="text-center">
          <div className="text-xs text-muted">Can't scan? Enter this key:</div>
          <code className="break-all text-sm font-semibold tracking-wide text-fg" data-testid="totp-secret">
            {spaced}
          </code>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-fg-soft" htmlFor="auth-code">
          6-digit code
        </label>
        <input
          id="auth-code"
          className="input w-full text-center tracking-[0.4em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || code.length !== 6}>
          {busy ? "Verifying…" : "Verify & enable"}
        </button>
      </div>
    </form>
  );
}
