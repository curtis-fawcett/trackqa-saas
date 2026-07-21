const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ApiError {
  error: string;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((body as ApiError).error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ── Auth types ──────────────────────────────────────────────

export interface AuthResponse {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  token?: string;
  verificationToken?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  role?: string;
  createdAt: string;
}

// ── Dashboard types ─────────────────────────────────────────

export interface DashboardStats {
  totalTickets: number;
  ticketsByStatus: Record<string, number>;
  ticketsByPriority: Record<string, number>;
  ticketsByType: Record<string, number>;
  myTickets: number;
  recentActivity: Array<{
    id: string;
    action: string;
    createdAt: string;
    ticket?: { id: string; title: string };
    user?: { name: string };
  }>;
}

// ── Project types ───────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  organizationId?: string;
  updatedAt?: string;
}

// ── Ticket types ────────────────────────────────────────────

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketType =
  | 'BUG'
  | 'FEATURE_REQUEST'
  | 'IMPROVEMENT'
  | 'TECHNICAL_DEBT'
  | 'DOCUMENTATION'
  | 'TASK';

export interface Ticket {
  id: string;
  title: string;
  description?: string;
  status: TicketStatus;
  priority: TicketPriority;
  severity: TicketSeverity;
  type: TicketType;
  tags: string[];
  reproductionSteps?: string;
  rootCause?: string;
  resolution?: string;
  projectId: string;
  assigneeId?: string;
  reporterId: string;
  createdAt: string;
  updatedAt: string;
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  reporter?: {
    id: string;
    name: string;
    email: string;
  };
  project?: {
    id: string;
    name: string;
  };
}

export interface CreateTicketData {
  title: string;
  description?: string;
  type: TicketType;
  priority: TicketPriority;
  severity: TicketSeverity;
  tags?: string[];
}

export interface UpdateTicketData {
  title?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  severity?: TicketSeverity;
  type?: TicketType;
  tags?: string[];
  reproductionSteps?: string;
  rootCause?: string;
  resolution?: string;
  assigneeId?: string | null;
}

export interface TicketsResponse {
  tickets: Ticket[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  type?: TicketType;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'status' | 'title';
  sortOrder?: 'asc' | 'desc';
}

// ── Comment types ───────────────────────────────────────────

export interface Comment {
  id: string;
  content: string;
  ticketId: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author?: {
    id: string;
    name: string;
    email: string;
  };
}

// ── Activity types ──────────────────────────────────────────

export interface ActivityEntry {
  id: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
  ticketId: string;
  userId: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

// ── Invite types ──────────────────────────────────────────

export type InviteRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface Invite {
  id: string;
  email: string;
  token: string;
  role: InviteRole;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  organizationId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  organization?: { id: string; name: string };
  project?: { id: string; name: string };
  invitedBy: { id: string; email: string; name: string | null };
}

export interface OrgMember {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; email: string; name: string | null };
}

export interface ProjectMember {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; email: string; name: string | null };
}

// ── Notification types ─────────────────────────────────────

export type NotificationType = 'ASSIGNED' | 'STATUS_CHANGE' | 'MENTION' | 'COMMENT' | 'INVITE';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  ticketId?: string | null;
  projectId?: string | null;
  read: boolean;
  createdAt: string;
  ticket?: { id: string; title: string } | null;
}

export interface NotificationsResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  notifications: Notification[];
}

export interface UnreadCount {
  count: number;
}

// ── Billing types ───────────────────────────────────────────

export interface BillingPlan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  highlighted: boolean;
}

export const STRIPE_LINKS: Record<string, string> = {
  Pro: 'https://buy.stripe.com/3cIcN55on9WY0PvcP24ZG00',
  Enterprise: 'https://buy.stripe.com/aFa9ATaIH3yA1zT8yM4ZG01',
};

export const PLANS: BillingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for individuals and small teams getting started.',
    features: [
      'Up to 5 users',
      '3 projects',
      'Basic kanban board',
      'Ticket comments & activity',
      'Email support',
    ],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$12',
    period: 'user/month',
    description: 'For growing teams that need power and flexibility.',
    features: [
      'Unlimited projects',
      'Unlimited users',
      'Configurable workflows',
      'File attachments',
      'Custom statuses',
      'Priority support',
    ],
    cta: 'Upgrade to Pro',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: '$20',
    period: 'user/month',
    description: 'For organizations that need security and control.',
    features: [
      'Everything in Pro',
      'SAML SSO',
      'Audit logs',
      'Dedicated onboarding',
      'SLA guarantees',
      'Custom integrations',
    ],
    cta: 'Upgrade to Enterprise',
    highlighted: false,
  },
];

// ── API client ──────────────────────────────────────────────

export const api = {
  // Auth
  register: (data: { email: string; password: string; name: string }) =>
    apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    apiRequest<{ token: string; user: { id: string; email: string; name: string; emailVerified: boolean } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: () => apiRequest<User>('/me'),

  // Dashboard
  getDashboardStats: () => apiRequest<DashboardStats>('/dashboard/stats'),

  // Projects
  getProjects: () => apiRequest<Project[]>('/projects'),

  getProject: (id: string) => apiRequest<Project>(`/projects/${id}`),

  updateProject: (id: string, data: { name?: string; description?: string }) =>
    apiRequest<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteProject: (id: string) =>
    apiRequest<{ message: string }>(`/projects/${id}`, { method: 'DELETE' }),

  // Tickets
  getTickets: (projectId: string, params?: TicketFilters) => {
    const cleanParams: Record<string, string> = {};
    if (params) {
      if (params.status) cleanParams['status'] = params.status;
      if (params.priority) cleanParams['priority'] = params.priority;
      if (params.type) cleanParams['type'] = params.type;
      if (params.search) cleanParams['q'] = params.search; // backend uses 'q' for search
      if (params.page && params.page > 1) cleanParams['page'] = String(params.page);
      if (params.pageSize) cleanParams['pageSize'] = String(params.pageSize);
      if (params.sortBy) {
        const order = params.sortOrder || 'desc';
        cleanParams['sort'] = `${params.sortBy}:${order}`;
      }
    }
    const qs = new URLSearchParams(cleanParams).toString();
    return apiRequest<TicketsResponse>(`/projects/${projectId}/tickets${qs ? '?' + qs : ''}`);
  },

  getTicket: (id: string) => apiRequest<Ticket>(`/tickets/${id}`),

  createTicket: (projectId: string, data: CreateTicketData) =>
    apiRequest<Ticket>(`/projects/${projectId}/tickets`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTicket: (id: string, data: UpdateTicketData) =>
    apiRequest<Ticket>(`/tickets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTicket: (id: string) =>
    apiRequest<{ message: string }>(`/tickets/${id}`, { method: 'DELETE' }),

  // Comments
  getComments: (ticketId: string) =>
    apiRequest<Comment[]>(`/tickets/${ticketId}/comments`),

  addComment: (ticketId: string, content: string) =>
    apiRequest<Comment>(`/tickets/${ticketId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  deleteComment: (commentId: string) =>
    apiRequest<{ message: string }>(`/comments/${commentId}`, { method: 'DELETE' }),

  // Activity
  getTicketActivity: (ticketId: string) =>
    apiRequest<ActivityEntry[]>(`/tickets/${ticketId}/activity`),

  // Organizations
  getOrganizations: () =>
    apiRequest<Array<{ id: string; name: string; description?: string; createdAt: string }>>('/organizations'),

  getOrganization: (id: string) =>
    apiRequest<{ id: string; name: string; description?: string; createdAt: string; owner: { id: string; email: string; name: string | null }; _count: { members: number; projects: number } }>(`/organizations/${id}`),

  getOrgMembers: (orgId: string) =>
    apiRequest<OrgMember[]>(`/organizations/${orgId}/members`),

  // Invites – Organization
  createOrgInvite: (orgId: string, data: { email: string; role: string }) =>
    apiRequest<Invite>(`/organizations/${orgId}/invites`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getOrgInvites: (orgId: string) =>
    apiRequest<Invite[]>(`/organizations/${orgId}/invites`),

  // Invites – Project
  createProjectInvite: (projectId: string, data: { email: string; role: string }) =>
    apiRequest<Invite>(`/projects/${projectId}/invites`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getProjectInvites: (projectId: string) =>
    apiRequest<Invite[]>(`/projects/${projectId}/invites`),

  getProjectMembers: (projectId: string) =>
    apiRequest<ProjectMember[]>(`/projects/${projectId}/members`),

  // Invites – Shared
  getInvite: (token: string) => apiRequest<Invite>(`/invites/${token}`),

  acceptInvite: (token: string) =>
    apiRequest<Invite>(`/invites/${token}/accept`, { method: 'POST' }),

  cancelInvite: (inviteId: string) =>
    apiRequest<Invite>(`/invites/${inviteId}`, { method: 'DELETE' }),

  getPendingInvites: () =>
    apiRequest<Invite[]>('/invites/pending'),

  // Notifications
  getNotifications: (params?: { unread?: boolean; page?: number; pageSize?: number }) => {
    const cleanParams: Record<string, string> = {};
    if (params?.unread !== undefined) cleanParams['unread'] = String(params.unread);
    if (params?.page && params.page > 1) cleanParams['page'] = String(params.page);
    if (params?.pageSize) cleanParams['pageSize'] = String(params.pageSize);
    const qs = new URLSearchParams(cleanParams).toString();
    return apiRequest<NotificationsResponse>(`/notifications${qs ? '?' + qs : ''}`);
  },

  getUnreadCount: () =>
    apiRequest<UnreadCount>('/notifications/unread-count'),

  markRead: (id: string) =>
    apiRequest<Notification>(`/notifications/${id}/read`, { method: 'PUT' }),

  markAllRead: () =>
    apiRequest<{ ok: boolean }>('/notifications/read-all', { method: 'PUT' }),

  // Email verification
  verifyEmail: (token: string) =>
    apiRequest<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  resendVerification: () =>
    apiRequest<{ verificationToken: string }>('/auth/resend-verification', {
      method: 'POST',
    }),

  // Password reset
  forgotPassword: (email: string) =>
    apiRequest<{ message: string; resetToken?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    apiRequest<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
};
