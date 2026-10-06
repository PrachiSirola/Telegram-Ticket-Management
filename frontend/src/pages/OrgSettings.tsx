import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, isOrgSA, useAuth } from "../auth";
import { useOrg } from "../org";
import { Modal } from "../components/Modal";
import { Dropdown } from "../components/Dropdown";

export default function OrgSettings() {
  const { me } = useAuth();
  const { activeOrgId } = useOrg();

  if (!isAdminOrAboveIn(me, activeOrgId)) return <Navigate to="/" replace />;
  return <Settings orgId={activeOrgId} sa={isOrgSA(me, activeOrgId)} />;
}

function Settings({ orgId, sa }: { orgId: string; sa: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me, refresh } = useAuth();

  const { data: settings } = useQuery({
    queryKey: ["orgSettings", orgId],
    queryFn: () => api.orgSettings(orgId),
  });
  const { data: members } = useQuery({
    queryKey: ["orgMembers", orgId],
    queryFn: () => api.orgMembers(orgId),
    enabled: sa,
  });

  const [name, setName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [confirmDeleteText, setConfirmDeleteText] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (settings) {
      setName(settings.name);
      setChatId(settings.telegramChatId ?? "");
      setBotToken("");
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      api.updateOrg(orgId, {
        ...(sa ? { name } : {}),
        ...(botToken !== "" || !settings?.telegramConfigured ? { telegramBotToken: botToken } : {}),
        telegramChatId: chatId,
      }),
    onSuccess: async () => {
      setMsg({ ok: true, text: "Settings saved." });
      await qc.invalidateQueries({ queryKey: ["orgSettings", orgId] });
      await qc.invalidateQueries({ queryKey: ["orgs"] });
      await refresh();
    },
    onError: (e: any) =>
      setMsg({ ok: false, text: e?.response?.data?.error ?? "Couldn't save settings." }),
  });

  const transfer = useMutation({
    mutationFn: () => api.transferOwnership(orgId, transferTo),
    onSuccess: async () => {
      setConfirmTransfer(false);
      await refresh();
      await qc.invalidateQueries({ queryKey: ["orgs"] });
      await qc.invalidateQueries({ queryKey: ["orgMembers", orgId] });
      navigate("/");
    },
    onError: (e: any) => {
      setConfirmTransfer(false);
      setMsg({ ok: false, text: e?.response?.data?.error ?? "Transfer failed." });
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteOrg(orgId),
    onSuccess: async () => {
      localStorage.removeItem("tm_active_org");
      await qc.invalidateQueries({ queryKey: ["orgs"] });
      await refresh();
      navigate("/");
    },
  });

  const admins = (members ?? []).filter((m) => m.role === "ADMIN" && !m.disabled);
  const transferTarget = admins.find((a) => a.userId === transferTo);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <div className="eyebrow mb-1">Organisation</div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">Settings</h1>
      </div>

      <div className="card p-6">
        <div className="eyebrow mb-4">{sa ? "General" : "Notifications"}</div>
        <div className="grid gap-4">
          {sa && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg-soft">Organisation name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
          )}

          <div className={sa ? "eyebrow mt-2" : "eyebrow"}>Telegram notifications</div>
          <p className="-mt-2 text-xs text-fg-soft">
            Create a bot via @BotFather, add it to your team chat, and paste the details here.
            Ticket events will be posted to that chat.
            {settings?.telegramConfigured && " Currently configured."}
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">Bot token</label>
            <input className="input" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={settings?.telegramBotToken ?? "123456:ABC…"} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-soft">Chat ID</label>
            <input className="input" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-100123456789" />
          </div>

          <div className="flex items-center gap-3">
            <button className="btn btn-primary" disabled={(sa && !name.trim()) || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save settings"}
            </button>
            {msg && (
              <span className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</span>
            )}
          </div>
        </div>
      </div>

      {sa && (
      <div className="card p-6">
        <div className="eyebrow mb-4">Transfer ownership</div>
        {admins.length === 0 ? (
          <p className="text-sm text-fg-soft">
            Promote a member to Admin first — ownership can only be transferred to an Admin.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-fg-soft">
              Hand the Super Admin role to an Admin. You'll become an Admin of this organisation.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1" style={{ minWidth: 200 }}>
                <Dropdown
                  placeholder="Choose an Admin…"
                  value={transferTo}
                  onChange={setTransferTo}
                  options={admins.map((a) => ({ value: a.userId, label: `${a.name} (${a.email})` }))}
                />
              </div>
              <button className="btn btn-danger btn-sm" disabled={!transferTo} onClick={() => setConfirmTransfer(true)}>
                Transfer
              </button>
            </div>
          </>
        )}
      </div>
      )}

      {sa && (
      <div className="card border-danger/30 p-6">
        <div className="eyebrow mb-4 text-danger">Danger zone</div>
        <p className="mb-3 text-sm text-fg-soft">
          Deleting the organisation permanently removes all projects, tickets, comments,
          attachments, and memberships.
        </p>
        <button className="btn btn-danger btn-sm" onClick={() => setShowDelete(true)}>
          Delete organisation
        </button>
      </div>
      )}

      <Modal open={confirmTransfer} onClose={() => setConfirmTransfer(false)} title="Transfer ownership?">
        <p className="mb-4 text-sm text-fg-soft">
          <b>{transferTarget?.name}</b> will become the Super Admin of <b>{settings?.name}</b>, and
          you ({me?.name}) will become an Admin. This can only be reversed by the new owner.
        </p>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setConfirmTransfer(false)}>Cancel</button>
          <button className="btn btn-danger btn-sm" disabled={transfer.isPending} onClick={() => transfer.mutate()}>
            {transfer.isPending ? "Transferring…" : "Transfer ownership"}
          </button>
        </div>
      </Modal>

      <Modal
        open={showDelete}
        onClose={() => { setShowDelete(false); setConfirmDeleteText(""); }}
        title="Delete organisation"
      >
        <p className="mb-3 text-sm text-fg-soft">
          This permanently deletes <b>{settings?.name}</b> and{" "}
          <span className="text-danger">everything in it</span>. This cannot be undone.
        </p>
        <div className="eyebrow mb-1.5">
          Type <span style={{ color: "var(--fg)", textTransform: "none" }}>{settings?.name}</span>{" "}
          to confirm
        </div>
        <input className="input mb-4" value={confirmDeleteText} onChange={(e) => setConfirmDeleteText(e.target.value)} placeholder={settings?.name} autoFocus />
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => { setShowDelete(false); setConfirmDeleteText(""); }}>Cancel</button>
          <button className="btn btn-danger btn-sm" disabled={confirmDeleteText.trim() !== settings?.name || del.isPending} onClick={() => del.mutate()}>
            {del.isPending ? "Deleting…" : "Delete organisation"}
          </button>
        </div>
      </Modal>
    </div>
  );
}