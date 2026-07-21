import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  TicketStatus,
  TicketPriority,
  TicketSeverity,
  TicketType,
  Comment,
  UpdateTicketData,
} from '@/lib/api';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Trash2, Loader2 } from 'lucide-react';

// ── Constants ─────────────────────────────────────────────

const STATUSES: { value: TicketStatus; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

const SEVERITIES: { value: TicketSeverity; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

const TYPE_COLORS: Record<TicketType, string> = {
  BUG: 'bg-red-900/50 text-red-300 border-red-800',
  FEATURE_REQUEST: 'bg-purple-900/50 text-purple-300 border-purple-800',
  IMPROVEMENT: 'bg-blue-900/50 text-blue-300 border-blue-800',
  TECHNICAL_DEBT: 'bg-yellow-900/50 text-yellow-300 border-yellow-800',
  DOCUMENTATION: 'bg-slate-700/50 text-slate-300 border-slate-600',
  TASK: 'bg-emerald-900/50 text-emerald-300 border-emerald-800',
};

function typeLabel(type: TicketType): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Page ──────────────────────────────────────────────────

export function TicketDetail() {
  const { id: ticketId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [commentText, setCommentText] = useState('');

  // Data queries
  const { data: ticket, isLoading, isError } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.getTicket(ticketId!),
    enabled: !!ticketId,
  });

  const { data: comments } = useQuery({
    queryKey: ['comments', ticketId],
    queryFn: () => api.getComments(ticketId!),
    enabled: !!ticketId,
  });

  const { data: activity } = useQuery({
    queryKey: ['activity', ticketId],
    queryFn: () => api.getTicketActivity(ticketId!),
    enabled: !!ticketId,
  });

  // Mutations
  const updateMutation = useMutation({
    mutationFn: (data: UpdateTicketData) => api.updateTicket(ticketId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTicket(ticketId!),
    onSuccess: () => {
      navigate(`/projects/${ticket?.projectId || ''}`);
    },
  });

  const commentMutation = useMutation({
    mutationFn: (content: string) => api.addComment(ticketId!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', ticketId] });
      setCommentText('');
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => api.deleteComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', ticketId] });
    },
  });

  // Handlers
  const handleTitleEdit = () => {
    if (ticket) {
      setEditTitle(ticket.title);
      setIsEditingTitle(true);
    }
  };

  const handleTitleSave = () => {
    if (editTitle.trim() && editTitle !== ticket?.title) {
      updateMutation.mutate({ title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleFieldUpdate = (field: keyof UpdateTicketData, value: string) => {
    updateMutation.mutate({ [field]: value } as UpdateTicketData);
  };

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (commentText.trim()) {
      commentMutation.mutate(commentText.trim());
    }
  };

  if (!ticketId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        No ticket ID provided.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-red-400">Failed to load ticket.</p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Button
          variant="ghost"
          size="sm"
          className="h-auto p-0 text-slate-400 hover:text-slate-200"
          onClick={() => navigate(`/projects/${ticket.projectId}`)}
        >
          <ArrowLeft className="h-3 w-3 mr-1" />
          {ticket.project?.name || 'Back to Project'}
        </Button>
        <span className="text-slate-600">/</span>
        <span className="text-slate-300 truncate">{ticket.title}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Main Content ──────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Title */}
          <div>
            {isEditingTitle ? (
              <div className="flex items-start gap-2">
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-xl font-bold h-auto py-2"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleSave();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                />
                <Button size="sm" onClick={handleTitleSave} disabled={updateMutation.isPending}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditingTitle(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <h1
                className="text-xl font-bold text-foreground cursor-pointer hover:text-primary transition-colors"
                onClick={handleTitleEdit}
                title="Click to edit"
              >
                {ticket.title}
              </h1>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className={`text-xs ${TYPE_COLORS[ticket.type]}`}>
                {typeLabel(ticket.type)}
              </Badge>
              <span className="text-xs text-slate-500">
                Created {formatDateShort(ticket.createdAt)}
              </span>
            </div>
          </div>

          {/* Description */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <Label className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
                Description
              </Label>
              <Textarea
                value={ticket.description || ''}
                onChange={() => {
                  // We save on blur, not every keystroke
                }}
                onBlur={(e) => {
                  if (e.target.value !== (ticket.description || '')) {
                    handleFieldUpdate('description', e.target.value);
                  }
                }}
                placeholder="No description provided. Click to add..."
                rows={4}
                className="resize-y"
              />
            </CardContent>
          </Card>

          {/* Reproduction Steps */}
          {(['BUG', 'IMPROVEMENT', 'TECHNICAL_DEBT'] as TicketType[]).includes(ticket.type) && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <Label className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
                  Reproduction Steps
                </Label>
                <Textarea
                  defaultValue={ticket.reproductionSteps || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (ticket.reproductionSteps || '')) {
                      handleFieldUpdate('reproductionSteps', e.target.value);
                    }
                  }}
                  placeholder="Steps to reproduce..."
                  rows={3}
                  className="resize-y"
                />
              </CardContent>
            </Card>
          )}

          {/* Root Cause */}
          {(ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <Label className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
                  Root Cause
                </Label>
                <Textarea
                  defaultValue={ticket.rootCause || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (ticket.rootCause || '')) {
                      handleFieldUpdate('rootCause', e.target.value);
                    }
                  }}
                  placeholder="Root cause analysis..."
                  rows={3}
                  className="resize-y"
                />
              </CardContent>
            </Card>
          )}

          {/* Resolution */}
          {(ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <Label className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
                  Resolution
                </Label>
                <Textarea
                  defaultValue={ticket.resolution || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (ticket.resolution || '')) {
                      handleFieldUpdate('resolution', e.target.value);
                    }
                  }}
                  placeholder="How was this resolved..."
                  rows={3}
                  className="resize-y"
                />
              </CardContent>
            </Card>
          )}

          {/* ── Comments ────────────────────────────── */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              Comments
              {comments ? ` (${comments.length})` : ''}
            </h2>

            <div className="space-y-3">
              {comments?.map((comment: Comment) => (
                <Card key={comment.id}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[10px] bg-slate-700 text-slate-300">
                            {initials(comment.author?.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-slate-300">
                          {comment.author?.name || 'Unknown'}
                        </span>
                        <span className="text-xs text-slate-600">
                          {formatDateShort(comment.createdAt)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-slate-600 hover:text-red-400"
                        onClick={() => deleteCommentMutation.mutate(comment.id)}
                        disabled={deleteCommentMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-sm text-slate-400 whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  </CardContent>
                </Card>
              ))}

              {(!comments || comments.length === 0) && (
                <p className="text-sm text-slate-600 text-center py-4">
                  No comments yet.
                </p>
              )}
            </div>

            {/* Add comment */}
            <form onSubmit={handleAddComment} className="flex gap-2">
              <Input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1"
              />
              <Button
                type="submit"
                size="sm"
                disabled={commentMutation.isPending || !commentText.trim()}
              >
                {commentMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Comment'
                )}
              </Button>
            </form>
          </div>

          <Separator />

          {/* ── Activity ────────────────────────────── */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Activity</h2>
            <div className="space-y-2">
              {activity?.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 text-sm">
                  <Avatar className="h-6 w-6 mt-0.5 shrink-0">
                    <AvatarFallback className="text-[10px] bg-slate-700 text-slate-300">
                      {initials(entry.user?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-slate-400">
                      <span className="font-medium text-slate-300">
                        {entry.user?.name || 'Someone'}
                      </span>{' '}
                      {entry.action}
                      {entry.field && (
                        <>
                          {' '}
                          <span className="text-slate-500">{entry.field}</span>
                        </>
                      )}
                      {entry.oldValue && entry.newValue && (
                        <>
                          {' '}
                          <span className="text-slate-600 line-through">{entry.oldValue}</span>
                          {' → '}
                          <span className="text-slate-300">{entry.newValue}</span>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {formatDateShort(entry.createdAt)}
                    </p>
                  </div>
                </div>
              ))}

              {(!activity || activity.length === 0) && (
                <p className="text-sm text-slate-600 text-center py-4">
                  No activity yet.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Sidebar ──────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <CardTitle className="text-sm font-semibold uppercase text-slate-500 tracking-wider">
                Details
              </CardTitle>

              {/* Status */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Status</Label>
                <Select
                  value={ticket.status}
                  onValueChange={(v) => handleFieldUpdate('status', v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Priority</Label>
                <Select
                  value={ticket.priority}
                  onValueChange={(v) => handleFieldUpdate('priority', v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Severity */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Severity</Label>
                <Select
                  value={ticket.severity}
                  onValueChange={(v) => handleFieldUpdate('severity', v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Type */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Type</Label>
                <div>
                  <Badge variant="outline" className={TYPE_COLORS[ticket.type]}>
                    {typeLabel(ticket.type)}
                  </Badge>
                </div>
              </div>

              {/* Assignee */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Assignee</Label>
                {ticket.assignee ? (
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-[10px] bg-slate-700 text-slate-300">
                        {initials(ticket.assignee.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-slate-300">{ticket.assignee.name}</span>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">Unassigned</p>
                )}
              </div>

              {/* Tags */}
              {ticket.tags && ticket.tags.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Tags</Label>
                  <div className="flex flex-wrap gap-1">
                    {ticket.tags.map((tag: string) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Dates */}
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-slate-500">Created: </span>
                  <span className="text-slate-400">{formatDate(ticket.createdAt)}</span>
                </div>
                <div>
                  <span className="text-slate-500">Updated: </span>
                  <span className="text-slate-400">{formatDate(ticket.updatedAt)}</span>
                </div>
              </div>

              <Separator />

              {/* Delete */}
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Ticket
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Ticket</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{ticket.title}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
