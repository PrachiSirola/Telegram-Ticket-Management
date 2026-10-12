import { useMemo, useState } from "react";
import { Dropdown } from "./Dropdown";
import { Avatar } from "./ui";
import type { AttachmentVisibility, TeamMember } from "../types";

export interface VisibilityValue {
  visibility: AttachmentVisibility;
  selectedUserIds: string[];
}

export const VISIBILITY_LABEL: Record<AttachmentVisibility, string> = {
  INTERNAL: "Internal",
  CLIENT_VISIBLE: "Customer",
  SELECTED: "Selected Members",
};

const OPTIONS = [
  { value: "INTERNAL", label: "Internal — team only" },
  { value: "CLIENT_VISIBLE", label: "Customer — project customers too" },
  { value: "SELECTED", label: "Selected Members — pick people" },
];

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  DEVELOPER: "Developer",
  CLIENT: "Customer",
};
export function VisibilityPicker({
  value,
  onChange,
  members,
  membersLoading,
  disabled,
  className = "",
  hideUserId,
}: {
  value: VisibilityValue;
  onChange: (v: VisibilityValue) => void;
  members: TeamMember[] | undefined;
  membersLoading?: boolean;
  disabled?: boolean;
  className?: string;
  hideUserId?: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (members ?? []).filter(
      (m) =>
        m.userId !== hideUserId &&
        (!needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)),
    );
  }, [members, q, hideUserId]);

  const toggle = (id: string) =>
    onChange({
      ...value,
      selectedUserIds: value.selectedUserIds.includes(id)
        ? value.selectedUserIds.filter((x) => x !== id)
        : [...value.selectedUserIds, id],
    });

  return (
    <div className={className}>
      <Dropdown
        className="w-full sm:w-72"
        size="sm"
        disabled={disabled}
        value={value.visibility}
        onChange={(v) => onChange({ ...value, visibility: v as AttachmentVisibility })}
        options={OPTIONS}
      />
      {value.visibility === "SELECTED" && (
        <div className="mt-2 rounded-lg border border-card-border bg-white p-2" data-testid="member-picker">
          <input
            className="input mb-2"
            placeholder="Search members…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search members"
            disabled={disabled}
          />
          <div className="max-h-44 space-y-0.5 overflow-y-auto">
            {membersLoading && <div className="p-2 text-xs text-muted">Loading members…</div>}
            {!membersLoading && shown.length === 0 && (
              <div className="p-2 text-xs text-muted">No members found.</div>
            )}
            {shown.map((m) => (
              <label
                key={m.userId}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={value.selectedUserIds.includes(m.userId)}
                  onChange={() => toggle(m.userId)}
                  disabled={disabled}
                />
                <Avatar name={m.name} url={m.avatarUrl} size={20} />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <span className="shrink-0 text-[11px] text-muted">{ROLE_LABEL[m.role] ?? m.role}</span>
              </label>
            ))}
          </div>
          <div className={`mt-1.5 text-xs ${value.selectedUserIds.length ? "text-muted" : "text-danger"}`}>
            {value.selectedUserIds.length
              ? `${value.selectedUserIds.length} selected · admins and you can always open it`
              : "Pick at least one member."}
          </div>
        </div>
      )}
    </div>
  );
}
export function VisibilityBadge({ visibility }: { visibility: AttachmentVisibility }) {
  const cls =
    visibility === "INTERNAL" ? "b-warn" : visibility === "SELECTED" ? "b-sage" : "b-outline-muted";
  return <span className={`badge ${cls}`}>{VISIBILITY_LABEL[visibility]}</span>;
}