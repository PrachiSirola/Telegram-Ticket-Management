export type OrgRole = "SUPER_ADMIN" | "ADMIN" | "DEVELOPER" | "CLIENT";
export type InviteRole = "ADMIN" | "DEVELOPER" | "CLIENT";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "DONE";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TicketType = "BUG" | "FEATURE" | "TASK";
export type CommentVisibility = "INTERNAL" | "CLIENT_VISIBLE";
export type AttachmentVisibility = "INTERNAL" | "CLIENT_VISIBLE" | "SELECTED";

export type WorkRange = "all" | "today" | "last_24h" | "last_3d" | "last_7d" | "last_1m" | "last_1y" | "custom";
export type WorkStatusFilter = "all" | "pending" | "in_progress" | "completed" | "overdue";
export type ProjectStatusFilter = "current" | "new" | "active" | "closed" | "archived" | undefined;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface TicketPage<T> extends Paged<T> {
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ProjectCounts {
  all: number;
  current: number;
  archived: number;
  new: number;
  active: number;
  closed: number;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isPlatformSuperAdmin: boolean;
  memberships: { orgId: string; orgName: string; role: OrgRole }[];
  twoFactorEnabled: boolean;
  twoFactorMethod: "PIN" | "PASSKEY" | null;
}

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  role: OrgRole;
}

export interface OrgSettings {
  id: string;
  name: string;
  timezone: string;
  telegramBotToken: string | null; 
  telegramChatId: string | null;
  telegramConfigured: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  ticketCount: number;
  createdAt: string;
  archivedAt?: string | null;
}
export interface ProjectImpact {
  tickets: number;
  comments: number;
  attachments: number;
}

export interface OrgMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: OrgRole;
  disabled: boolean;
  projectIds: string[];
  createdAt: string;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: InviteRole;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  projectIds: string[];
  expiresAt: string;
  inviteUrl: string | null;
}

export interface BulkInviteResult {
  email: string;
  status: "invited" | "skipped" | "invalid";
  reason?: string;
  emailSent?: boolean;
  inviteUrl?: string;
}

export interface BulkInviteResponse {
  results: BulkInviteResult[];
  summary: { total: number; invited: number; emailFailed: number; skipped: number; invalid: number };
}

export interface InviteInfo {
  email: string;
  role: InviteRole;
  orgId: string;
  orgName: string;
  projectNames: string[];
  accountExists: boolean;
}

export interface UserLite {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Member extends UserLite {
  membershipId: string;
  userId: string;
  role: OrgRole;
}

export interface Ticket {
  id: string;
  projectId: string;
  orgId?: string;
  project?: { id: string; name: string; archivedAt?: string | null };
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  dueDate: string | null;
  estimate: number | null;
  assignee: UserLite | null;
  reporter: UserLite | null;
  archivedAt?: string | null;
  can?: TicketPermissions;
  following?: boolean;
  followerCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketPermissions {
  edit: boolean;
  changeStatus: boolean;
  changePriority: boolean;
  assign: boolean;
  selfAssign: boolean;
  duplicate: boolean;
  addFollower: boolean;
  move: boolean;
  archive: boolean;
  restore: boolean;
  delete: boolean;
}

export interface CommentAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  previewable?: boolean;
}

export interface Comment {
  id: string;
  ticketId: string;
  body: string;
  visibility: CommentVisibility;
  parentId: string | null;
  createdAt: string;
  editedAt?: string | null;
  canEdit?: boolean;
  canDelete?: boolean;
  author: { id: string; name: string; avatarUrl: string | null };
  attachments?: CommentAttachment[];
}

export interface Attachment {
  id: string;
  ticketId?: string;
  commentId?: string | null;
  filename: string;
  mimeType: string;
  size: number;
  visibility: AttachmentVisibility;
  createdAt: string;
  uploader: { id: string; name: string };
  previewable?: boolean;
  canDelete?: boolean;
  canChangeVisibility?: boolean;
  /** Who a "Selected Members" file is shared with (team only). */
  selectedUsers?: { id: string; name: string }[];
}

/** A person who can be picked as a follower / file recipient (the project's team). */
export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: OrgRole;
}

export type ActivityType =
  | "TICKET_CREATED"
  | "STATUS_CHANGED"
  | "PRIORITY_CHANGED"
  | "TYPE_CHANGED"
  | "TITLE_CHANGED"
  | "DESCRIPTION_CHANGED"
  | "DUE_DATE_CHANGED"
  | "ASSIGNED"
  | "ATTACHMENT_ADDED"
  | "ATTACHMENT_DELETED"
  | "ATTACHMENT_VISIBILITY_CHANGED"
  | "COMMENT_ADDED"
  | "COMMENT_EDITED"
  | "COMMENT_DELETED"
  | "FOLLOWER_ADDED"
  | "FOLLOWER_REMOVED"
  | "MOVED"
  | "ARCHIVED"
  | "RESTORED"
  | "DUPLICATED";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  field: string | null;
  from: string | null;
  to: string | null;
  meta?: Record<string, unknown> | null;
  internalOnly: boolean;
  createdAt: string;
  actor: { id: string; name: string; avatarUrl: string | null };
}

export interface Notification {
  id: string;
  type: "ASSIGNED" | "STATUS_CHANGED" | "COMMENTED" | "MENTIONED";
  ticketId: string;
  isRead: boolean;
  createdAt: string;
  payload: { message: string; ticketTitle: string } | null;
  ticket: { id: string; title: string; projectId: string; orgId: string; orgName: string };
}

export interface CompletedTicket extends Ticket {
  completedAt: string;
}

export interface MyWorkSummary {
  assigned: number;
  inProgress: number;
  completed: number;
  overdue: number;
}

export interface MyWorkResponse {
  summary: MyWorkSummary;
  work: Paged<Ticket>;
  completedWork: Paged<CompletedTicket>;
  /** The resolved window (org timezone) the server applied. */
  window?: { range: WorkRange; fromDay: string | null; toDay: string | null; timezone: string };
}