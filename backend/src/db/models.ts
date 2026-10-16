import mongoose, { Schema, type Model } from "mongoose";
import { dao, newId } from "./dao.js";
import * as T from "./types.js";

const opts = (createdAt: boolean | string = true, updatedAt = false) => ({
  versionKey: false as const,
  minimize: false,
  timestamps: { createdAt: createdAt as any, updatedAt: updatedAt as any },
});
const id = { type: String, default: newId };
const ref = (required = true) => ({ type: String, required, default: required ? undefined : null });
const str = (extra: Record<string, unknown> = {}) => ({ type: String, required: true, ...extra });
const optStr = () => ({ type: String, default: null });
const optDate = () => ({ type: Date, default: null });
const oneOf = (values: readonly string[], extra: Record<string, unknown> = {}) => ({
  type: String,
  enum: { values: [...values], message: "{PATH} must be one of: " + values.join(", ") },
  required: true,
  ...extra,
});


const userSchema = new Schema(
  {
    _id: id,
    email: str({ unique: true, lowercase: true, trim: true, match: /^\S+@\S+$/ }),
    name: str({ trim: true }),
    passwordHash: str(),
    avatarUrl: optStr(),
    platformRole: { type: String, enum: [...T.PLATFORM_ROLES, null], default: null },
    platformAdminActive: { type: Boolean, default: true },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorMethod: { type: String, enum: [...T.TWO_FACTOR_METHODS, null], default: null },
    pinHash: optStr(),
    pinAttempts: { type: Number, default: 0, min: 0 },
    pinLockedUntil: optDate(),

    totpSecretEnc: optStr(),
    totpEnabledAt: optDate(),
    totpPendingSecretEnc: optStr(),
    totpPendingAt: optDate(),
    totpLastStep: { type: Number, default: null },
    totpAttempts: { type: Number, default: 0, min: 0 },
    totpLockedUntil: optDate(),
  },
  opts(true, true),
);

const orgSchema = new Schema(
  {
    _id: id,
    name: str({ trim: true }),
    telegramBotToken: optStr(),
    telegramChatId: optStr(),
    timezone: { type: String, default: "Asia/Kolkata", required: true },
  },
  opts(true, true),
);

const membershipSchema = new Schema(
  {
    _id: id,
    userId: ref(),
    orgId: ref(),
    role: oneOf(T.ORG_ROLES),
    disabled: { type: Boolean, default: false },
  },
  opts(),
);
membershipSchema.index({ userId: 1, orgId: 1 }, { unique: true });
membershipSchema.index({ orgId: 1 });
// Exactly ONE Super Admin per organisation (was a partial unique index in the SQL init migration).
membershipSchema.index({ orgId: 1, role: 1 }, { unique: true, partialFilterExpression: { role: "SUPER_ADMIN" }, name: "one_super_admin_per_org" });


const projectSchema = new Schema(
  {
    _id: id,
    orgId: ref(),
    name: str({ trim: true }),
    description: { type: String, default: "" },
    archivedAt: optDate(),
  },
  opts(true, true),
);
projectSchema.index({ orgId: 1 });
projectSchema.index({ orgId: 1, name: 1 });

const projectLinkSchema = () => {
  const s = new Schema({ _id: id, projectId: ref(), membershipId: ref() }, opts());
  s.index({ projectId: 1, membershipId: 1 }, { unique: true });
  s.index({ membershipId: 1 });
  return s;
};


const inviteSchema = new Schema(
  {
    _id: id,
    email: str({ lowercase: true, trim: true }),
    orgId: ref(),
    role: oneOf(T.INVITE_ROLES),
    projectIds: { type: [String], default: [] },
    token: str({ unique: true }),
    status: oneOf(T.INVITE_STATUSES, { default: "PENDING" }),
    invitedById: ref(),
    expiresAt: { type: Date, required: true },
  },
  opts(),
);
inviteSchema.index({ email: 1 });
inviteSchema.index({ orgId: 1 });

const pendingSignupSchema = new Schema(
  {
    _id: id,
    email: str({ unique: true, lowercase: true, trim: true }),
    orgName: str(),
    name: str(),
    passwordHash: str(),
    codeHash: str(),
    attempts: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  opts(),
);

const tokenSchema = () => {
  const s = new Schema(
    { _id: id, userId: ref(), tokenHash: str({ unique: true }), expiresAt: { type: Date, required: true }, usedAt: optDate() },
    opts(),
  );
  s.index({ userId: 1 });
  return s;
};

const orgCreationRequestSchema = new Schema(
  {
    _id: id,
    requestedById: ref(),
    orgName: str(),
    tokenHash: str({ unique: true }),
    expiresAt: { type: Date, required: true },
    verifiedAt: optDate(),
    createdOrgId: optStr(),
  },
  opts(),
);
orgCreationRequestSchema.index({ requestedById: 1 });

const passwordHistorySchema = new Schema({ _id: id, userId: ref(), passwordHash: str() }, opts());
passwordHistorySchema.index({ userId: 1, createdAt: 1 });
const pinHistorySchema = new Schema({ _id: id, userId: ref(), pinHash: str() }, opts());
pinHistorySchema.index({ userId: 1, createdAt: 1 });


const ticketSchema = new Schema(
  {
    _id: id,
    projectId: ref(),
    title: str(),
    description: { type: String, default: "" },
    status: oneOf(T.TICKET_STATUSES, { default: "OPEN" }),
    priority: oneOf(T.TICKET_PRIORITIES, { default: "MEDIUM" }),
    type: oneOf(T.TICKET_TYPES, { default: "TASK" }),
    assigneeIds: { type: [String], default: [] },
    reporterId: ref(),
    dueDate: optDate(),
    estimate: { type: Number, default: null, min: 0 },
    archivedAt: optDate(),
  },
  opts(true, true),
);
ticketSchema.index({ projectId: 1, status: 1 });
ticketSchema.index({ projectId: 1, updatedAt: -1 });
ticketSchema.index({ assigneeIds: 1 }); 
ticketSchema.index({ reporterId: 1 });
ticketSchema.index({ archivedAt: 1 });

const activitySchema = new Schema(
  {
    _id: id,
    ticketId: ref(),
    actorId: ref(),
    type: oneOf(T.ACTIVITY_TYPES),
    field: optStr(),
    fromValue: optStr(),
    toValue: optStr(),
    meta: { type: Schema.Types.Mixed, default: null },
    internalOnly: { type: Boolean, default: false },
  },
  opts(),
);
activitySchema.index({ ticketId: 1, createdAt: 1 });
const frozen = () => {
  throw new Error("TicketActivity is append-only: rows can't be updated or deleted directly.");
};
activitySchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "findOneAndDelete", "deleteOne", "deleteMany"] as any,
  function (this: any, next: () => void) {
    if (this.getOptions?.().cascade === true) return next();
    frozen();
  },
);
activitySchema.pre("save", function (next) {
  if (!this.isNew) frozen();
  next();
});

const followerSchema = new Schema({ _id: id, ticketId: ref(), userId: ref(), addedById: ref() }, opts());
followerSchema.index({ ticketId: 1, userId: 1 }, { unique: true });
followerSchema.index({ userId: 1 });

const statusHistorySchema = new Schema(
  {
    _id: id,
    ticketId: ref(),
    fromStatus: { type: String, enum: [...T.TICKET_STATUSES, null], default: null },
    toStatus: oneOf(T.TICKET_STATUSES),
    changedById: ref(),
  },
  opts("changedAt"),
);
statusHistorySchema.index({ ticketId: 1, changedAt: 1 });
statusHistorySchema.index({ toStatus: 1, changedAt: 1 });

const commentSchema = new Schema(
  {
    _id: id,
    ticketId: ref(),
    authorId: ref(),
    parentId: ref(false),
    body: str(),
    visibility: oneOf(T.COMMENT_VISIBILITIES, { default: "INTERNAL" }),
    editedAt: optDate(),
  },
  opts(),
);
commentSchema.index({ ticketId: 1, createdAt: 1 });
commentSchema.index({ parentId: 1 });

const attachmentSchema = new Schema(
  {
    _id: id,
    ticketId: ref(),
    commentId: ref(false),
    uploaderId: ref(),
    filename: str(),
    mimeType: str(),
    size: { type: Number, required: true, min: 0 },
    storageKey: str(),
    visibility: oneOf(T.ATTACHMENT_VISIBILITY_VALUES, { default: "CLIENT_VISIBLE" }),
  },
  opts(),
);
attachmentSchema.index({ ticketId: 1 });
attachmentSchema.index({ commentId: 1 });

const attachmentAccessSchema = new Schema({ _id: id, attachmentId: ref(), userId: ref() }, opts());
attachmentAccessSchema.index({ attachmentId: 1, userId: 1 }, { unique: true });
attachmentAccessSchema.index({ userId: 1 });

const notificationSchema = new Schema(
  {
    _id: id,
    userId: ref(),
    type: oneOf(T.NOTIFICATION_TYPES),
    ticketId: ref(),
    isRead: { type: Boolean, default: false },
    payload: { type: Schema.Types.Mixed, default: null },
  },
  opts(),
);
notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ ticketId: 1 });


const m = <N extends string>(name: N, schema: Schema, collection: string): Model<any> =>
  (mongoose.models[name] as Model<any>) ?? mongoose.model(name, schema, collection);

const UserM = m("User", userSchema, "users");
const OrgM = m("Organization", orgSchema, "organizations");
const MembershipM = m("OrgMembership", membershipSchema, "orgmemberships");
const ProjectM = m("Project", projectSchema, "projects");
const ProjectClientM = m("ProjectClient", projectLinkSchema(), "projectclients");
const ProjectDeveloperM = m("ProjectDeveloper", projectLinkSchema(), "projectdevelopers");
const InviteM = m("Invite", inviteSchema, "invites");
const PendingSignupM = m("PendingSignup", pendingSignupSchema, "pendingsignups");
const PasswordResetM = m("PasswordResetToken", tokenSchema(), "passwordresettokens");
const PinResetM = m("PinResetToken", tokenSchema(), "pinresettokens");
const OrgCreationM = m("OrgCreationRequest", orgCreationRequestSchema, "orgcreationrequests");
const PasswordHistoryM = m("PasswordHistory", passwordHistorySchema, "passwordhistories");
const PinHistoryM = m("PinHistory", pinHistorySchema, "pinhistories");
const TicketM = m("Ticket", ticketSchema, "tickets");
const ActivityM = m("TicketActivity", activitySchema, "ticketactivities");
const FollowerM = m("TicketFollower", followerSchema, "ticketfollowers");
const StatusHistoryM = m("TicketStatusHistory", statusHistorySchema, "ticketstatushistories");
const CommentM = m("Comment", commentSchema, "comments");
const AttachmentM = m("Attachment", attachmentSchema, "attachments");
const AttachmentAccessM = m("AttachmentAccess", attachmentAccessSchema, "attachmentaccesses");
const NotificationM = m("Notification", notificationSchema, "notifications");

export const allModels: Model<any>[] = [
  UserM, OrgM, MembershipM, ProjectM, ProjectClientM, ProjectDeveloperM, InviteM, PendingSignupM, PasswordResetM,
  PinResetM, OrgCreationM, PasswordHistoryM, PinHistoryM, TicketM, ActivityM, FollowerM, StatusHistoryM, CommentM,
  AttachmentM, AttachmentAccessM, NotificationM,
];

export const ActivityModel = ActivityM;


export const db = {
  users: dao<T.User>(UserM),
  orgs: dao<T.Organization>(OrgM),
  memberships: dao<T.OrgMembership>(MembershipM),
  projects: dao<T.Project>(ProjectM),
  projectClients: dao<T.ProjectClient>(ProjectClientM),
  projectDevelopers: dao<T.ProjectDeveloper>(ProjectDeveloperM),
  invites: dao<T.Invite>(InviteM),
  pendingSignups: dao<T.PendingSignup>(PendingSignupM),
  passwordResets: dao<T.ResetToken>(PasswordResetM),
  pinResets: dao<T.ResetToken>(PinResetM),
  orgCreations: dao<T.OrgCreationRequest>(OrgCreationM),
  passwordHistory: dao<T.PasswordHistory>(PasswordHistoryM),
  pinHistory: dao<T.PinHistory>(PinHistoryM),
  tickets: dao<T.Ticket>(TicketM),
  activity: dao<T.TicketActivity>(ActivityM),
  followers: dao<T.TicketFollower>(FollowerM),
  statusHistory: dao<T.TicketStatusHistory>(StatusHistoryM),
  comments: dao<T.Comment>(CommentM),
  attachments: dao<T.Attachment>(AttachmentM),
  attachmentAccess: dao<T.AttachmentAccess>(AttachmentAccessM),
  notifications: dao<T.Notification>(NotificationM),
};
