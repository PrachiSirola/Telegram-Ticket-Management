export type OrgRole = "SUPER_ADMIN" | "ADMIN" | "DEVELOPER" | "CLIENT";
export type InviteRole = "ADMIN" | "DEVELOPER" | "CLIENT";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "DONE";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TicketType = "BUG" | "FEATURE" | "TASK";
export type CommentVisibility = "INTERNAL" | "CLIENT_VISIBLE";

export interface Me {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  memberships: { orgId: string; orgName: string; role: OrgRole }[];
}

export interface Organization {
  id: string;
  name: string;
  role: OrgRole;
}

export interface OrgSettings {
  id: string;
  name: string;
  telegramBotToken: string | null; // masked by the API
  telegramChatId: string | null;
  telegramConfigured: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  ticketCount: number;
  createdAt: string;
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

export interface InviteInfo {
  email: string;
  role: InviteRole;
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
  userId: string;
  role: OrgRole;
}

export interface Ticket {
  id: string;
  projectId: string;
  orgId?: string;
  project?: { id: string; name: string };
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  dueDate: string | null;
  estimate: number | null;
  assignee: UserLite | null;
  reporter: UserLite | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Comment {
  id: string;
  ticketId: string;
  body: string;
  visibility: CommentVisibility;
  parentId: string | null;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
  attachments?: CommentAttachment[];
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  visibility: CommentVisibility;
  createdAt: string;
  uploader: { id: string; name: string };
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
