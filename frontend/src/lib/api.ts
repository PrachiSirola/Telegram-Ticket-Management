import axios from "axios";
import type {
  Attachment,
  Comment,
  CommentVisibility,
  InviteInfo,
  Me,
  Member,
  MyWorkResponse,
  Notification,
  Organization,
  OrgInvite,
  OrgMember,
  OrgSettings,
  Paged,
  Project,
  ProjectCounts,
  ProjectStatusFilter,
  Ticket,
  TicketPriority,
  TicketStatus,
  TicketType,
  WorkRange,
  WorkStatusFilter,
} from "../types";

const defaultBaseURL =
  typeof window !== "undefined"
    ? `http://${window.location.hostname === "localhost" ? "localhost" : window.location.hostname}:1019`
    : "http://localhost:1019";

const baseURL = import.meta.env.VITE_API_URL ?? defaultBaseURL;

export const http = axios.create({ baseURL, withCredentials: true });

export interface AuthConfig {
  passwordReset: boolean;
}

export const api = {
  // --- Auth ---
  authConfig: () => http.get<AuthConfig>("/auth/config").then((r) => r.data),
  me: () => http.get<Me>("/auth/me").then((r) => r.data),
  login: (data: { email: string; password: string }) =>
    http.post("/auth/login", data).then((r) => r.data),
  logout: () => http.post("/auth/logout").then((r) => r.data),

  // Organisation signup (open, OTP-verified)
  signup: (data: { orgName: string; name: string; email: string; password: string }) =>
    http.post("/auth/signup", data).then((r) => r.data),
  verifySignup: (data: { email: string; code: string }) =>
    http.post("/auth/signup/verify", data).then((r) => r.data),
  resendSignupOtp: (email: string) =>
    http.post("/auth/signup/resend", { email }).then((r) => r.data),

  // Invite-link onboarding
  inviteInfo: (token: string) =>
    http.get<InviteInfo>(`/auth/invite/${token}`).then((r) => r.data),
  register: (data: { token: string; name: string; password: string }) =>
    http.post("/auth/register", data).then((r) => r.data),
  acceptInvite: (token: string) =>
    http.post(`/auth/invite/${token}/accept`).then((r) => r.data),

  // Password reset
  forgotPassword: (email: string) =>
    http.post("/auth/forgot-password", { email }).then((r) => r.data),
  resetPassword: (data: { token: string; password: string }) =>
    http.post("/auth/reset-password", data).then((r) => r.data),

  // --- Profile ---
  updateProfile: (data: { name: string }) =>
    http.patch<Me>("/me/profile", data).then((r) => r.data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    http.post("/me/change-password", data).then((r) => r.data),

  // --- Organisations ---
  orgs: () => http.get<Organization[]>("/orgs").then((r) => r.data),
    requestCreateOrg: (name: string) =>
    http.post<{ ok: true }>("/orgs/create/request", { name }).then((r) => r.data),
  verifyCreateOrg: (token: string) =>
    http.post<Organization>("/orgs/create/verify", { token }).then((r) => r.data),
  orgSettings: (orgId: string) =>
    http.get<OrgSettings>(`/orgs/${orgId}/settings`).then((r) => r.data),
  updateOrg: (
    orgId: string,
    data: { name?: string; telegramBotToken?: string; telegramChatId?: string },
  ) => http.patch<OrgSettings>(`/orgs/${orgId}`, data).then((r) => r.data),
  deleteOrg: (orgId: string) => http.delete(`/orgs/${orgId}`).then((r) => r.data),
  transferOwnership: (orgId: string, userId: string) =>
    http.post(`/orgs/${orgId}/transfer-ownership`, { userId }).then((r) => r.data),

  // --- Members ---
  orgMembers: (orgId: string) =>
    http.get<OrgMember[]>(`/orgs/${orgId}/members`).then((r) => r.data),
  // Opt-in pagination, same convention as projectsPaged above. Used by the
  // Members page's list; OrgSettings' ownership-transfer picker keeps using
  // orgMembers() for the complete list.
  orgMembersPaged: (orgId: string, params: { page: number; pageSize: number; q?: string }) =>
    http
      .get<Paged<OrgMember>>(`/orgs/${orgId}/members`, {
        params: { page: params.page, pageSize: params.pageSize, q: params.q || undefined },
      })
      .then((r) => r.data),
  updateMember: (
    orgId: string,
    userId: string,
    data: { role?: "ADMIN" | "DEVELOPER" | "CLIENT"; disabled?: boolean },
  ) => http.patch(`/orgs/${orgId}/members/${userId}`, data).then((r) => r.data),
  removeMember: (orgId: string, userId: string) =>
    http.delete(`/orgs/${orgId}/members/${userId}`).then((r) => r.data),
  // Member Detail page: profile + project access + assigned-ticket breakdown.
  memberDetail: (orgId: string, userId: string) =>
    http.get(`/orgs/${orgId}/members/${userId}/detail`).then((r) => r.data),
  memberTickets: (
    orgId: string,
    userId: string,
    params: { status?: string; priority?: string; type?: string; page: number; pageSize: number },
  ) =>
    http.get(`/orgs/${orgId}/members/${userId}/tickets`, { params }).then((r) => r.data),

  // --- Invites ---
  invites: (orgId: string) =>
    http.get<OrgInvite[]>(`/orgs/${orgId}/invites`).then((r) => r.data),
  invite: (orgId: string, data: { email: string; role: string; projectIds?: string[] }) =>
    http.post(`/orgs/${orgId}/invites`, data).then((r) => r.data),
  revokeInvite: (orgId: string, inviteId: string) =>
    http.delete(`/orgs/${orgId}/invites/${inviteId}`).then((r) => r.data),
  resendInvite: (orgId: string, inviteId: string) =>
    http.post(`/orgs/${orgId}/invites/${inviteId}/resend`).then((r) => r.data),

  // --- Projects ---
  projects: (orgId: string) =>
    http.get<Project[]>(`/orgs/${orgId}/projects`).then((r) => r.data),
  // Opt-in pagination: same endpoint, but passing page/pageSize gets back a
  // { items, total, page, pageSize } envelope instead of the plain array.
  // Used by the Dashboard's paginated project grid; every other caller keeps
  // using `projects()` above and is unaffected.
  projectsPaged: (
    orgId: string,
    params: { page: number; pageSize: number; status?: ProjectStatusFilter; q?: string },
  ) =>
    http
      .get<Paged<Project>>(`/orgs/${orgId}/projects`, {
        params: { page: params.page, pageSize: params.pageSize, status: params.status, q: params.q || undefined },
      })
      .then((r) => r.data),
  // Live counts for the All/Active/Closed tab bar — derived from ticket
  // state server-side, not stored, so they're always accurate.
  projectCounts: (orgId: string) =>
    http.get<ProjectCounts>(`/orgs/${orgId}/projects/counts`).then((r) => r.data),
  createProject: (orgId: string, data: { name: string; description?: string }) =>
    http.post<Project>(`/orgs/${orgId}/projects`, data).then((r) => r.data),
  updateProject: (orgId: string, projectId: string, data: { name?: string; description?: string }) =>
    http.patch<Project>(`/orgs/${orgId}/projects/${projectId}`, data).then((r) => r.data),
  deleteProject: (orgId: string, projectId: string) =>
    http.delete(`/orgs/${orgId}/projects/${projectId}`).then((r) => r.data),
  projectMembers: (orgId: string, projectId: string) =>
    http.get<Member[]>(`/orgs/${orgId}/projects/${projectId}/members`).then((r) => r.data),
  setProjectClients: (orgId: string, projectId: string, membershipIds: string[]) =>
    http.put(`/orgs/${orgId}/projects/${projectId}/clients`, { membershipIds }).then((r) => r.data),
  setProjectDevelopers: (orgId: string, projectId: string, membershipIds: string[]) =>
    http
      .put(`/orgs/${orgId}/projects/${projectId}/developers`, { membershipIds })
      .then((r) => r.data),

  // --- 2FA ---
  twoFactorStatus: () =>
    http.get<{ twoFactorEnabled: boolean; twoFactorMethod: "PIN" | "PASSKEY" | null; hasPin: boolean }>("/me/2fa").then((r) => r.data),
  setPin: (data: { currentPassword: string; pin: string; confirmPin: string }) =>
    http.post("/me/2fa/pin", data).then((r) => r.data),
  toggle2fa: (data: { enabled: boolean; method?: "PIN" | "PASSKEY" }) =>
    http.post("/me/2fa/toggle", data).then((r) => r.data),
  verify2fa: (pin: string) => http.post("/auth/2fa/verify", { pin }).then((r) => r.data),

  forgotPin: () => http.post("/auth/2fa/forgot-pin").then((r) => r.data),
  resetPin: (data: { token: string; pin: string; confirmPin: string }) =>
    http.post("/auth/2fa/reset-pin", data).then((r) => r.data),

  // --- Tickets ---
  tickets: (orgId: string, projectId: string, params?: Record<string, string>) =>
    http
      .get<Ticket[]>(`/orgs/${orgId}/projects/${projectId}/tickets`, { params })
      .then((r) => r.data),
  createTicket: (
    orgId: string,
    projectId: string,
    data: {
      title: string;
      description?: string;
      priority?: TicketPriority;
      type?: TicketType;
      dueDate?: string | null;
      assigneeId?: string | null;
      mentions?: string[];
    },
  ) =>
    http.post<Ticket>(`/orgs/${orgId}/projects/${projectId}/tickets`, data).then((r) => r.data),

  ticket: (id: string) => http.get<Ticket>(`/tickets/${id}`).then((r) => r.data),
  updateTicket: (
    id: string,
    data: Partial<{
      title: string;
      description: string;
      status: TicketStatus;
      priority: TicketPriority;
      type: TicketType;
      dueDate: string | null;
      assigneeId: string | null;
    }>,
  ) => http.patch<Ticket>(`/tickets/${id}`, data).then((r) => r.data),
  selfAssign: (id: string) =>
    http.post<Ticket>(`/tickets/${id}/self-assign`).then((r) => r.data),
  deleteTicket: (id: string) => http.delete(`/tickets/${id}`).then((r) => r.data),

  // --- Comments ---
  comments: (ticketId: string) =>
    http.get<Comment[]>(`/tickets/${ticketId}/comments`).then((r) => r.data),
  addComment: (
    ticketId: string,
    data: { body: string; visibility?: CommentVisibility; parentId?: string | null; mentions?: string[] },
  ) => http.post<Comment>(`/tickets/${ticketId}/comments`, data).then((r) => r.data),
  deleteComment: (ticketId: string, commentId: string) =>
    http.delete(`/tickets/${ticketId}/comments/${commentId}`).then((r) => r.data),

  // --- Attachments ---
  attachments: (ticketId: string) =>
    http.get<Attachment[]>(`/tickets/${ticketId}/attachments`).then((r) => r.data),
  uploadAttachment: (
    ticketId: string,
    file: File,
    visibility: CommentVisibility,
    commentId?: string,
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("visibility", visibility);
    if (commentId) form.append("commentId", commentId);
    return http.post<Attachment>(`/tickets/${ticketId}/attachments`, form).then((r) => r.data);
  },
  attachmentBlob: (attId: string) =>
    http.get(`/attachments/${attId}/download`, { responseType: "blob" }).then((r) => r.data as Blob),
  deleteAttachment: (attId: string) =>
    http.delete(`/attachments/${attId}`).then((r) => r.data),

  // --- Me / notifications ---
  myTickets: (orgId: string, filter: "assigned" | "reported" = "assigned") =>
    http.get<Ticket[]>("/me/tickets", { params: { orgId, filter } }).then((r) => r.data),
  myWork: (
    orgId: string,
    params: {
      range: WorkRange;
      from?: string;
      to?: string;
      status?: WorkStatusFilter;
      projectId?: string;
      q?: string;
      page: number;
      pageSize: number;
      completedPage: number;
      completedPageSize: number;
    },
  ) => http.get<MyWorkResponse>("/me/work", { params: { orgId, ...params } }).then((r) => r.data),
  notifications: () =>
    http
      .get<{ unread: number; notifications: Notification[] }>("/me/notifications")
      .then((r) => r.data),
  markRead: (id: string) => http.post(`/me/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => http.post("/me/notifications/read-all").then((r) => r.data),
};