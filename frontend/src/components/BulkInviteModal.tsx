import { humanize, toast } from "../lib/toast";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAllowedEmailDomain } from "../lib/emailDomains";
import { Modal } from "./Modal";
import { Dropdown, MultiDropdown } from "./Dropdown";
import type { BulkInviteResponse } from "../types";

export const BULK_INVITE_MAX = 50;

type ProjectMode = "NONE" | "SAME" | "PER_PERSON";
type Step = "compose" | "review" | "results";

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Split pasted text on commas, semicolons, spaces and new lines; drop <>, quotes; lower-case; de-duplicate. */
export function parseEmails(raw: string) {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^[<"'(]+|[>"')]+$/g, "").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const entries: { email: string; valid: boolean }[] = [];
  let duplicates = 0;
  for (const t of tokens) {
    const email = t.toLowerCase();
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    entries.push({ email, valid: EMAIL_RE.test(email) && isAllowedEmailDomain(email) });
  }
  return { entries, duplicates };
}

/** Bulk invite: paste many emails, pick one role, choose how projects are assigned, review the outcome per address. */
export function BulkInviteModal({
  open,
  onClose,
  orgId,
  orgName,
  canInviteAdmin,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  orgName: string;
  canInviteAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("compose");
  const [raw, setRaw] = useState("");
  const [role, setRole] = useState("DEVELOPER");
  const [mode, setMode] = useState<ProjectMode>("NONE");
  const [sameProjects, setSameProjects] = useState<string[]>([]);
  const [perPerson, setPerPerson] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<BulkInviteResponse | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => api.projects(orgId),
    enabled: !!orgId && open,
  });
  const projectOptions = (projects ?? []).map((p) => ({ value: p.id, label: p.name }));

  const parsed = useMemo(() => parseEmails(raw), [raw]);
  const validEntries = parsed.entries.filter((e) => e.valid);
  const invalidEntries = parsed.entries.filter((e) => !e.valid);
  const tooMany = parsed.entries.length > BULK_INVITE_MAX;

  const takesProjects = role !== "ADMIN";
  const effectiveMode: ProjectMode = !takesProjects ? "NONE" : role === "CLIENT" && mode === "NONE" ? "SAME" : mode;

  function projectsFor(email: string) {
    if (effectiveMode === "SAME") return sameProjects;
    if (effectiveMode === "PER_PERSON") return perPerson[email] ?? [];
    return [];
  }

  // Clients must have a project; with SAME that's one shared pick, with PER_PERSON every valid row needs one.
  const projectsOk =
    role !== "CLIENT" ||
    (effectiveMode === "SAME"
      ? sameProjects.length > 0
      : effectiveMode === "PER_PERSON"
        ? validEntries.every((e) => (perPerson[e.email] ?? []).length > 0)
        : false);

  const mut = useMutation({
    mutationFn: () =>
      api.bulkInvite(orgId, {
        role,
        items: parsed.entries.map((e) => ({
          email: e.email,
          ...(takesProjects && e.valid ? { projectIds: projectsFor(e.email) } : {}),
        })),
      }),
    meta: { errorTitle: "Couldn't send the invitations" },
    onSuccess: (data) => {
      const s = data.summary;
      const extras = [
        s.skipped ? `${s.skipped} skipped` : "",
        s.invalid ? `${s.invalid} invalid` : "",
        s.emailFailed ? `${s.emailFailed} email${s.emailFailed === 1 ? "" : "s"} failed (link still available)` : "",
      ].filter(Boolean);
      const noun = s.invited === 1 ? "invitation" : "invitations";
      if (s.invited === 0) toast.warning(`No invitations were created: ${extras.join(", ") || "nothing to send"}.`, { title: "Bulk invite" });
      else if (extras.length) toast.warning(`${s.invited} ${noun} created; ${extras.join(", ")}.`, { title: "Bulk invite finished with issues" });
      else toast.success(`${s.invited} ${noun} sent as ${humanize(role)}.`);
      setResult(data);
      setStep("results");
      qc.invalidateQueries({ queryKey: ["invites", orgId] });
    },
  });

  function reset() {
    setStep("compose");
    setRaw("");
    setRole("DEVELOPER");
    setMode("NONE");
    setSameProjects([]);
    setPerPerson({});
    setResult(null);
    mut.reset();
  }
  // Esc / outside-click while a dropdown menu is open should only close that menu, not throw away the
  // typed list. The dropdown closes itself first, so remember (in the capture phase, before it does)
  // whether a menu was open when the keypress/click started.
  const menuWasOpen = useRef(false);
  useEffect(() => {
    if (!open) return;
    const rec = () => {
      menuWasOpen.current = !!document.querySelector(".dd-menu");
    };
    document.addEventListener("keydown", rec, true);
    document.addEventListener("mousedown", rec, true);
    return () => {
      document.removeEventListener("keydown", rec, true);
      document.removeEventListener("mousedown", rec, true);
    };
  }, [open]);
  function requestClose() {
    if (menuWasOpen.current) {
      menuWasOpen.current = false;
      return;
    }
    close();
  }

  function close() {
    if (mut.isPending) return;
    onClose();
    // Let the closing animation-less unmount happen first, then clear for next time.
    setTimeout(reset, 0);
  }

  const canContinue = validEntries.length > 0 && !tooMany;
  const sendLabel = `Send ${validEntries.length} invite${validEntries.length === 1 ? "" : "s"}`;

  return (
    <Modal open={open} onClose={requestClose} title="Bulk invite" width={step === "compose" ? 640 : 720}>
      {step === "compose" && (
        <div className="space-y-4">
          <div>
            <div className="eyebrow mb-1.5">Emails</div>
            <textarea
              className="input"
              rows={5}
              autoFocus
              placeholder={"one@example.com, two@example.com\nthree@example.com"}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              aria-label="Email addresses"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="bulk-counts">
              <span className="text-muted">
                {validEntries.length} valid{parsed.duplicates > 0 ? ` · ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? "" : "s"} ignored` : ""}
              </span>
              {invalidEntries.length > 0 && (
                <span className="text-danger">
                  {invalidEntries.length} invalid: {invalidEntries.slice(0, 3).map((e) => e.email).join(", ")}
                  {invalidEntries.length > 3 ? "…" : ""}
                </span>
              )}
              {tooMany && <span className="text-danger">Max {BULK_INVITE_MAX} people at a time.</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-4">
            <div style={{ minWidth: 170 }}>
              <div className="eyebrow mb-1.5">Role (everyone)</div>
              <Dropdown
                value={role}
                onChange={(v) => {
                  setRole(v);
                  setSameProjects([]);
                  setPerPerson({});
                  if (v === "CLIENT" && mode === "NONE") setMode("SAME");
                }}
                options={[
                  ...(canInviteAdmin ? [{ value: "ADMIN", label: "Admin" }] : []),
                  { value: "DEVELOPER", label: "Developer" },
                  { value: "CLIENT", label: "Client" },
                ]}
              />
            </div>

            {takesProjects && (
              <div className="min-w-0 flex-1" style={{ minWidth: 260 }}>
                <div className="eyebrow mb-1.5">Projects</div>
                <div className="space-y-1.5" role="radiogroup" aria-label="Project assignment">
                  {(
                    [
                      ["NONE", "No project assignment", role === "CLIENT"],
                      ["SAME", "Same projects for everyone", false],
                      ["PER_PERSON", "Different projects for each person", false],
                    ] as const
                  ).map(([v, label, disabled]) => (
                    <label
                      key={v}
                      className={`flex items-center gap-2 text-sm ${disabled ? "cursor-not-allowed text-muted" : "cursor-pointer text-fg"}`}
                    >
                      <input
                        type="radio"
                        name="bulk-mode"
                        checked={effectiveMode === v}
                        disabled={disabled}
                        onChange={() => setMode(v)}
                      />
                      {label}
                      {disabled && <span className="text-[11px]">(clients need a project)</span>}
                    </label>
                  ))}
                </div>
                {effectiveMode === "SAME" && (
                  <div className="mt-2">
                    <MultiDropdown
                      values={sameProjects}
                      onChange={setSameProjects}
                      placeholder="Select projects…"
                      options={projectOptions}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button className="btn btn-secondary btn-sm" onClick={close}>
              Cancel
            </button>
            {effectiveMode === "PER_PERSON" ? (
              <button className="btn btn-primary btn-sm" disabled={!canContinue} onClick={() => setStep("review")}>
                Next: assign projects
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                disabled={!canContinue || !projectsOk || mut.isPending}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? "Sending…" : sendLabel}
              </button>
            )}
          </div>
          {mut.isError && <ErrorLine error={mut.error} />}
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <p className="text-xs text-fg-soft">
            Choose projects for each person joining <strong>{orgName}</strong> as{" "}
            <strong>{role.toLowerCase()}</strong>.{role === "CLIENT" ? " Clients need at least one." : " Leave empty for none."}
          </p>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-card-border" data-testid="bulk-review">
            <div className="divide-line pb-24">
              {parsed.entries.map((e) => (
                <div key={e.email} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{e.email}</div>
                  {e.valid ? (
                    <MultiDropdown
                      className="w-56"
                      size="sm"
                      values={perPerson[e.email] ?? []}
                      onChange={(v) => setPerPerson((p) => ({ ...p, [e.email]: v }))}
                      placeholder={role === "CLIENT" ? "Select projects…" : "No projects"}
                      options={projectOptions}
                    />
                  ) : (
                    <span className="badge b-danger">Invalid email</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setStep("compose")} disabled={mut.isPending}>
              Back
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!projectsOk || mut.isPending}
              onClick={() => mut.mutate()}
            >
              {mut.isPending ? "Sending…" : sendLabel}
            </button>
          </div>
          {mut.isError && <ErrorLine error={mut.error} />}
        </div>
      )}

      {step === "results" && result && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs" data-testid="bulk-summary">
            <span className="badge b-ok">{result.summary.invited} invited</span>
            {result.summary.emailFailed > 0 && <span className="badge b-warn">{result.summary.emailFailed} email not sent</span>}
            {result.summary.skipped > 0 && <span className="badge b-neutral">{result.summary.skipped} skipped</span>}
            {result.summary.invalid > 0 && <span className="badge b-danger">{result.summary.invalid} failed</span>}
          </div>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-card-border" data-testid="bulk-results">
            <div className="divide-line">
              {result.results.map((r, i) => (
                <ResultRow key={`${r.email}-${i}`} r={r} />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button className="btn btn-secondary btn-sm" onClick={reset}>
              Invite more
            </button>
            <button className="btn btn-primary btn-sm" onClick={close}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ResultRow({ r }: { r: BulkInviteResponse["results"][number] }) {
  const [copied, setCopied] = useState(false);
  const badge =
    r.status === "invited" ? (
      r.emailSent ? <span className="badge b-ok">Invited</span> : <span className="badge b-warn">Invited · email not sent</span>
    ) : r.status === "skipped" ? (
      <span className="badge b-neutral">Skipped</span>
    ) : (
      <span className="badge b-danger">Failed</span>
    );
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5" data-testid="bulk-result-row">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{r.email}</div>
        {r.reason && <div className="text-xs text-muted">{r.reason}</div>}
      </div>
      {r.status === "invited" && !r.emailSent && r.inviteUrl && (
        <button
          className="btn btn-secondary btn-sm shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(r.inviteUrl!).then(
              () => toast.success(`Invitation link for ${r.email} copied to clipboard.`),
              () => toast.error("Couldn't copy the link. Select it and copy manually."),
            );
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      )}
      {badge}
    </div>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  return (
    <p className="text-sm text-danger">{(error as any)?.response?.data?.error ?? "Failed to send invites."}</p>
  );
}
