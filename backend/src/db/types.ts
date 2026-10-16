export const ORG_ROLES = ["SUPER_ADMIN", "ADMIN", "DEVELOPER", "CLIENT"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const INVITE_ROLES = ["ADMIN", "DEVELOPER", "CLIENT"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const INVITE_STATUSES = ["PENDING", "ACCEPTED", "EXPIRED"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "DONE"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_TYPES = ["BUG", "FEATURE", "TASK"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const COMMENT_VISIBILITIES = ["INTERNAL", "CLIENT_VISIBLE"] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export const NOTIFICATION_TYPES = ["ASSIGNED", "STATUS_CHANGED", "COMMENTED", "MENTIONED"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ATTACHMENT_VISIBILITY_VALUES = ["INTERNAL", "CLIENT_VISIBLE", "SELECTED"] as const;
export type AttachmentVisibility = (typeof ATTACHMENT_VISIBILITY_VALUES)[number];

export const ACTIVITY_TYPES = [
  "TICKET_CREATED", "STATUS_CHANGED", "PRIORITY_CHANGED", "TYPE_CHANGED", "TITLE_CHANGED",
  "DESCRIPTION_CHANGED", "DUE_DATE_CHANGED", "ASSIGNED", "ATTACHMENT_ADDED", "ATTACHMENT_DELETED",
  "ATTACHMENT_VISIBILITY_CHANGED", "COMMENT_ADDED", "COMMENT_EDITED", "COMMENT_DELETED",
  "FOLLOWER_ADDED", "FOLLOWER_REMOVED", "MOVED", "ARCHIVED", "RESTORED", "DUPLICATED",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const TWO_FACTOR_METHODS = ["PIN", "PASSKEY"] as const;
export type TwoFactorMethod = (typeof TWO_FACTOR_METHODS)[number];

export const PLATFORM_ROLES = ["SUPER_ADMIN"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  avatarUrl: string | null;
  platformRole: PlatformRole | null;
  platformAdminActive: boolean;
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
  pinHash: string | null;
  pinAttempts: number;
  pinLockedUntil: Date | null;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpPendingSecretEnc: string | null;
  totpPendingAt: Date | null;
  totpLastStep: number | null;
  totpAttempts: number;
  totpLockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Organization {
  id: string;
  name: string;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgMembership {
  id: string;
  userId: string;
  orgId: string;
  role: OrgRole;
  disabled: boolean;
  createdAt: Date;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  description: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectClient {
  id: string;
  projectId: string;
  membershipId: string;
  createdAt: Date;
}
export type ProjectDeveloper = ProjectClient;

export interface Invite {
  id: string;
  email: string;
  orgId: string;
  role: InviteRole;
  projectIds: string[];
  token: string;
  status: InviteStatus;
  invitedById: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface PendingSignup {
  id: string;
  email: string;
  orgName: string;
  name: string;
  passwordHash: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface ResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface OrgCreationRequest {
  id: string;
  requestedById: string;
  orgName: string;
  tokenHash: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdOrgId: string | null;
  createdAt: Date;
}

export interface PasswordHistory { id: string; userId: string; passwordHash: string; createdAt: Date }
export interface PinHistory { id: string; userId: string; pinHash: string; createdAt: Date }

export interface Ticket {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;

  assigneeIds: string[];
  reporterId: string;
  dueDate: Date | null;
  estimate: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketActivity {
  id: string;
  ticketId: string;
  actorId: string;
  type: ActivityType;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  meta: Record<string, any> | null;
  internalOnly: boolean;
  createdAt: Date;
}

export interface TicketFollower { id: string; ticketId: string; userId: string; addedById: string; createdAt: Date }

export interface TicketStatusHistory {
  id: string;
  ticketId: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  changedById: string;
  changedAt: Date;
}

export interface Comment {
  id: string;
  ticketId: string;
  authorId: string;
  parentId: string | null;
  body: string;
  visibility: CommentVisibility;
  editedAt: Date | null;
  createdAt: Date;
}

export interface Attachment {
  id: string;
  ticketId: string;
  commentId: string | null;
  uploaderId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  visibility: AttachmentVisibility;
  createdAt: Date;
}

export interface AttachmentAccess { id: string; attachmentId: string; userId: string; createdAt: Date }

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  ticketId: string;
  isRead: boolean;
  payload: Record<string, any> | null;
  createdAt: Date;
}
