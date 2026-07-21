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

interface AuthResponse {
  id: string;
  email: string;
  name: string;
  token?: string;
}

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface DashboardStats {
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

export const api = {
  // Auth
  register: (data: { email: string; password: string; name: string }) =>
    apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    apiRequest<AuthResponse & { token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: () => apiRequest<User>('/me'),

  // Dashboard
  getDashboardStats: () => apiRequest<DashboardStats>('/dashboard/stats'),

  // Projects
  getProjects: () => apiRequest<Array<{ id: string; name: string; description?: string; createdAt: string }>>('/projects'),

  // Organizations
  getOrganizations: () =>
    apiRequest<Array<{ id: string; name: string; description?: string; createdAt: string }>>('/organizations'),
};
