import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import { useOrg } from "../org";

export default function CreateOrg() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me, refresh, logout } = useAuth();
  const { orgs, setActiveOrg } = useOrg();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstOrg = orgs.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const org = await api.createOrg(name);
      setActiveOrg(org.id);
      await refresh();
      await qc.invalidateQueries({ queryKey: ["orgs"] });
      navigate("/");
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Couldn't create the organisation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-96 p-7">
        <div className="eyebrow mb-3">Ticket Management</div>
        <h1 className="text-2xl font-bold tracking-tight">
          {firstOrg ? "You're not in any organisation." : "New organisation."}
        </h1>
        <p className="mb-6 mt-1 text-sm text-fg-soft">
          {firstOrg
            ? "Create one to get started (you'll be its Super Admin), or ask an administrator for an invite link."
            : "You'll be the new organisation's Super Admin."}
        </p>

        <form onSubmit={submit} className="grid gap-3">
          <input
            className="input"
            type="text"
            placeholder="Organisation name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Creating…" : "Create organisation"}
          </button>
        </form>

        {err && <p className="mt-3 text-sm text-danger">{err}</p>}

        <p className="mt-5 text-center text-sm text-fg-soft">
          {firstOrg ? (
            <>
              Signed in as {me?.email} ·{" "}
              <button className="link" onClick={() => logout()}>
                Log out
              </button>
            </>
          ) : (
            <button className="link" onClick={() => navigate(-1)}>
              Cancel
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
