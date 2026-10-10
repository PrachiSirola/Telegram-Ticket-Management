import { failure, q, toast } from "../lib/toast";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { useOrg } from "../org";
import { IconAlertTriangle, IconCheckCircle } from "../components/Icons";

type Status = "verifying" | "done" | "error";

export default function VerifyCreateOrg() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me, refresh } = useAuth();
  const { setActiveOrg } = useOrg();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [status, setStatus] = useState<Status>("verifying");
  const [orgName, setOrgName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErr("This confirmation link is missing its token.");
      return;
    }
    // Guard against React 18 StrictMode's double-invoke in dev, and against
    // re-running if this component re-renders — the token is single-use, so
    // firing the request twice would surface a false "expired" error.
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const org = await api.verifyCreateOrg(token);
        setOrgName(org.name);
        toast.success(`Organisation ${q(org.name)} was created. You are its Super Admin.`);
        setActiveOrg(org.id);
        await refresh();
        await qc.invalidateQueries({ queryKey: ["orgs"] });
        setStatus("done");
      } catch (e: any) {
        setErr(failure(e, "This confirmation link is invalid or has expired."));
        setStatus("error");
      }
    })();
  }, [token]);

  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center overflow-hidden rounded-2xl px-4">
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
      <div
        className="absolute inset-0 z-[1]"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.15) 60%, rgba(0,0,0,0.1) 100%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md">
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

        <div
          className="overflow-hidden rounded-2xl border border-white/30 p-8 text-center shadow-dropdown"
          style={{
            background: 'rgba(255,255,255,0.88)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          }}
        >
          {status === "verifying" && (
            <>
              <h1
                className="text-2xl font-bold tracking-tight text-fg"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Confirming…
              </h1>
              <p className="mb-0 mt-2 text-sm leading-relaxed text-fg-soft">
                Creating your organisation, one moment.
              </p>
            </>
          )}

          {status === "done" && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-ok">
                <IconCheckCircle size={22} />
              </div>
              <h1
                className="text-2xl font-bold tracking-tight text-fg"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {orgName} is ready
              </h1>
              <p className="mb-6 mt-2 text-sm leading-relaxed text-fg-soft">
                You're its Super Admin. Signed in as {me?.email}.
              </p>
              <button className="btn btn-primary btn-block" onClick={() => navigate("/")}>
                Go to dashboard
              </button>
            </>
          )}

          {status === "error" && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger">
                <IconAlertTriangle size={22} />
              </div>
              <h1
                className="text-2xl font-bold tracking-tight text-fg"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Couldn't confirm
              </h1>
              <p className="mb-6 mt-2 text-sm leading-relaxed text-fg-soft">{err}</p>
              <Link to="/create-org" className="btn btn-primary btn-block">
                Start again
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}