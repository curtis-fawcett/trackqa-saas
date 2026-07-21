import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Ticket, TicketStatus, TicketType, TicketPriority, TicketSeverity } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CreateTicketDialog } from '@/components/CreateTicketDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, ArrowLeft, UserPlus, Users, X, Mail, Clock, Loader2 } from 'lucide-react';

const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN: 'border-slate-500 text-slate-400',
  IN_PROGRESS: 'border-blue-500 text-blue-400',
  RESOLVED: 'border-green-500 text-green-400',
  CLOSED: 'border-slate-600 text-slate-500',
};

const TYPE_COLORS: Record<TicketType, string> = {
  BUG: 'bg-red-900/50 text-red-300 border-red-800',
  FEATURE_REQUEST: 'bg-purple-900/50 text-purple-300 border-purple-800',
  IMPROVEMENT: 'bg-blue-900/50 text-blue-300 border-blue-800',
  TECHNICAL_DEBT: 'bg-yellow-900/50 text-yellow-300 border-yellow-800',
  DOCUMENTATION: 'bg-slate-700/50 text-slate-300 border-slate-600',
  TASK: 'bg-emerald-900/50 text-emerald-300 border-emerald-800',
};

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  LOW: 'bg-slate-700/50 text-slate-400 border-slate-600',
  MEDIUM: 'bg-blue-900/50 text-blue-300 border-blue-800',
  HIGH: 'bg-orange-900/50 text-orange-300 border-orange-800',
  CRITICAL: 'bg-red-900/50 text-red-300 border-red-800',
};

function typeLabel(type: TicketType): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProjectDetail() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'board' | 'members'>('board');

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  const {
    data: ticketsData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['tickets', projectId],
    queryFn: () => api.getTickets(projectId!, { page: 1 }),
    enabled: !!projectId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createTicket>[1]) =>
      api.createTicket(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', projectId] });
      setCreateOpen(false);
    },
  });

  const tickets = ticketsData?.tickets ?? [];

  // Members & invites
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.getProjectMembers(projectId!),
    enabled: !!projectId && activeTab === 'members',
  });

  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ['project-invites', projectId],
    queryFn: () => api.getProjectInvites(projectId!),
    enabled: !!projectId && activeTab === 'members',
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [inviteError, setInviteError] = useState('');

  const createInvite = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api.createProjectInvite(projectId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-invites', projectId] });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      setInviteError('');
    },
    onError: (err: Error) => {
      setInviteError(err.message);
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => api.cancelInvite(inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-invites', projectId] });
    },
  });

  const handleProjectInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    createInvite.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  const grouped = STATUSES.reduce(
    (acc, status) => {
      acc[status] = tickets.filter((t) => t.status === status);
      return acc;
    },
    {} as Record<TicketStatus, Ticket[]>,
  );

  const handleCreate = (data: {
    title: string;
    description: string;
    type: TicketType;
    priority: TicketPriority;
    severity: TicketSeverity;
    tags: string[];
  }) => {
    createMutation.mutate({
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      severity: data.severity,
      tags: data.tags,
    });
  };

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        No project ID provided.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-slate-400">Loading board...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-red-400">Failed to load tickets.</p>
        <p className="text-sm text-slate-500">{(error as Error)?.message}</p>
        <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['tickets', projectId] })}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-400 mb-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-slate-400 hover:text-slate-200"
              onClick={() => navigate('/projects')}
            >
              <ArrowLeft className="h-3 w-3 mr-1" />
              Back to Projects
            </Button>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            {project?.name || 'Project Board'}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{tickets.length} tickets</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Ticket
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('board')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'board'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Board
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'members'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="h-4 w-4" />
          Members
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'board' ? (
        <>
          {/* Kanban Board */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {STATUSES.map((status) => (
              <div key={status} className="space-y-2">
                {/* Column header */}
                <div className="flex items-center gap-2 px-1">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${STATUS_COLORS[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {grouped[status].length}
                  </Badge>
                </div>

                {/* Column cards */}
                <div className="space-y-2 min-h-[200px]">
                  {grouped[status].length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center">
                      <p className="text-xs text-slate-600">No tickets</p>
                    </div>
                  ) : (
                    grouped[status].map((ticket) => (
                      <TicketCard
                        key={ticket.id}
                        ticket={ticket}
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-6">
          {/* Members list */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-slate-400" />
                  Project Members
                </CardTitle>
                <CardDescription>
                  {members?.length ?? 0} member{(members?.length ?? 0) !== 1 ? 's' : ''}
                </CardDescription>
              </div>
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invite
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite to Project</DialogTitle>
                    <DialogDescription>
                      Send an invitation to join {project?.name || 'this project'}.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleProjectInvite}>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="p-email">Email address</Label>
                        <Input
                          id="p-email"
                          type="email"
                          placeholder="colleague@company.com"
                          value={inviteEmail}
                          onChange={(e) => { setInviteEmail(e.target.value); setInviteError(''); }}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="p-role">Role</Label>
                        <Select value={inviteRole} onValueChange={setInviteRole}>
                          <SelectTrigger id="p-role">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MEMBER">Member</SelectItem>
                            <SelectItem value="OWNER">Owner</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {inviteError && (
                        <p className="text-sm text-red-400">{inviteError}</p>
                      )}
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createInvite.isPending}>
                        {createInvite.isPending ? 'Sending...' : 'Send Invite'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {membersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : members && members.length > 0 ? (
                <div className="space-y-3">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/20 text-primary text-xs">
                            {(member.user.name || '?')
                              .split(' ')
                              .map((n: string) => n[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-slate-200">
                            {member.user.name || 'Unknown'}
                          </p>
                          <p className="text-xs text-slate-500">{member.user.email}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className={
                        member.role === 'OWNER'
                          ? 'bg-yellow-900/50 text-yellow-300 border-yellow-800'
                          : 'bg-slate-700/50 text-slate-300 border-slate-600'
                      }>
                        {member.role}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-4 text-center">No members yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Pending Invites */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Mail className="h-5 w-5 text-slate-400" />
                Pending Invites
              </CardTitle>
              <CardDescription>
                {invites?.length ?? 0} pending invite{(invites?.length ?? 0) !== 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invitesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : invites && invites.length > 0 ? (
                <div className="space-y-3">
                  {invites.map((invite) => (
                    <div key={invite.id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-slate-800 flex items-center justify-center">
                          <Mail className="h-4 w-4 text-slate-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-300">{invite.email}</p>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{invite.role}</span>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(invite.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-slate-400 hover:text-red-400"
                        onClick={() => cancelInvite.mutate(invite.id)}
                        disabled={cancelInvite.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-4 text-center">No pending invites.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Dialog */}
      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        isSubmitting={createMutation.isPending}
      />
    </div>
  );
}

function TicketCard({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const initials = ticket.assignee?.name
    ? ticket.assignee.name
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : null;

  return (
    <Card
      className="cursor-pointer hover:border-slate-600 transition-colors p-3"
      onClick={onClick}
    >
      <CardContent className="p-0 space-y-2">
        {/* Title */}
        <p className="text-sm font-medium text-slate-200 line-clamp-2 leading-snug">
          {ticket.title}
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 leading-normal ${TYPE_COLORS[ticket.type]}`}>
            {typeLabel(ticket.type)}
          </Badge>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 leading-normal ${PRIORITY_COLORS[ticket.priority]}`}>
            {ticket.priority}
          </Badge>
        </div>

        {/* Assignee */}
        {initials && (
          <div className="flex items-center gap-1.5 pt-1">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[9px] bg-slate-700 text-slate-300">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-[11px] text-slate-500 truncate">
              {ticket.assignee?.name}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
