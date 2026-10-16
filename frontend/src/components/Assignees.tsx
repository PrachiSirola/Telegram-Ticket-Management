import { Avatar } from "./ui";
import type { UserLite } from "../types";
export function AssigneeAvatars({
  assignees,
  max = 3,
  size = 32,
  names = false,
}: {
  assignees: UserLite[];
  max?: number;
  size?: number;
  names?: boolean;
}) {
  const shown = assignees.slice(0, max);
  const extra = assignees.length - shown.length;
  const label = assignees.map((a) => a.name).join(", ");
  return (
    <div className="flex items-center gap-2.5" title={label} data-testid="row-assignees">
      <div className="flex -space-x-2">
        {shown.map((a) => (
          <span key={a.id} className="rounded-full ring-2 ring-[var(--card-bg,theme(colors.white))]">
            <Avatar name={a.name} url={a.avatarUrl} size={size} />
          </span>
        ))}
        {extra > 0 && (
          <span
            className="flex items-center justify-center rounded-full border border-card-border bg-card text-[11px] font-medium text-muted ring-2 ring-[var(--card-bg,theme(colors.white))]"
            style={{ width: size, height: size }}
          >
            +{extra}
          </span>
        )}
      </div>
      {names && (
        <div className="hidden lg:block">
          <div className="text-sm font-medium text-fg">
            {assignees.length === 1 ? assignees[0].name : `${assignees[0].name} +${assignees.length - 1}`}
          </div>
          <div className="text-[11px] text-muted">{assignees.length === 1 ? "Assignee" : `${assignees.length} assignees`}</div>
        </div>
      )}
    </div>
  );
}
export function AssigneeList({ assignees }: { assignees: UserLite[] }) {
  if (assignees.length === 0)
    return (
      <span className="text-muted" data-testid="detail-assignee">
        Unassigned
      </span>
    );
  return (
    <ul className="flex flex-col gap-1.5" data-testid="detail-assignee">
      {assignees.map((a) => (
        <li key={a.id} className="flex items-center gap-2" data-testid="detail-assignee-item">
          <Avatar name={a.name} url={a.avatarUrl} size={22} />
          {a.name}
        </li>
      ))}
    </ul>
  );
}
