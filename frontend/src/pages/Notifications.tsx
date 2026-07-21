import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Notification as NotifType, type NotificationType } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Bell,
  CheckCheck,
  UserPlus,
  MessageSquare,
  AtSign,
  ArrowRightLeft,
  UserCheck,
  ChevronRight,
  Loader2,
} from 'lucide-react';

const PAGE_SIZE = 20;

const typeIcons: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  ASSIGNED: UserCheck,
  STATUS_CHANGE: ArrowRightLeft,
  MENTION: AtSign,
  COMMENT: MessageSquare,
  INVITE: UserPlus,
};

const typeColors: Record<NotificationType, string> = {
  ASSIGNED: 'text-blue-400',
  STATUS_CHANGE: 'text-amber-400',
  MENTION: 'text-purple-400',
  COMMENT: 'text-emerald-400',
  INVITE: 'text-rose-400',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function groupByDate(notifications: NotifType[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: { label: string; items: NotifType[] }[] = [];
  const todayItems: NotifType[] = [];
  const yesterdayItems: NotifType[] = [];
  const olderItems: NotifType[] = [];

  for (const n of notifications) {
    const d = new Date(n.createdAt);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) {
      todayItems.push(n);
    } else if (d.getTime() === yesterday.getTime()) {
      yesterdayItems.push(n);
    } else {
      olderItems.push(n);
    }
  }

  if (todayItems.length) groups.push({ label: 'Today', items: todayItems });
  if (yesterdayItems.length) groups.push({ label: 'Yesterday', items: yesterdayItems });
  if (olderItems.length) groups.push({ label: 'Older', items: olderItems });

  return groups;
}

export function Notifications() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', page],
    queryFn: () => api.getNotifications({ page, pageSize: PAGE_SIZE }),
  });

  const markAllMutation = useMutation({
    mutationFn: api.markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unreadCount'] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: api.markRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unreadCount'] });
    },
  });

  const handleClick = async (n: NotifType) => {
    if (!n.read) {
      await markReadMutation.mutateAsync(n.id);
    }
    if (n.ticketId) {
      navigate(`/tickets/${n.ticketId}`);
    } else if (n.projectId) {
      navigate(`/projects/${n.projectId}`);
    }
  };

  const notifications = data?.notifications ?? [];
  const groups = groupByDate(notifications);
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-slate-100">Notifications</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAllMutation.mutate()}
          disabled={markAllMutation.isPending}
          className="gap-2"
        >
          {markAllMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="h-4 w-4" />
          )}
          Mark all read
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : notifications.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Bell className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-lg font-medium">No notifications</p>
            <p className="text-sm">You're all caught up!</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.label} className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 px-1">
                {group.label}
              </h2>
              <Card className="border-border bg-card overflow-hidden">
                <CardContent className="p-0">
                  {group.items.map((n, i) => {
                    const Icon = typeIcons[n.type] || Bell;
                    const colorClass = typeColors[n.type] || 'text-slate-400';
                    const isLast = i === group.items.length - 1;

                    return (
                      <button
                        key={n.id}
                        onClick={() => handleClick(n)}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50 ${
                          !n.read ? 'bg-primary/5' : ''
                        } ${!isLast ? 'border-b border-border' : ''}`}
                      >
                        <div className={`mt-0.5 ${colorClass}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium truncate ${!n.read ? 'text-slate-100' : 'text-slate-300'}`}>
                              {n.title}
                            </p>
                            {!n.read && (
                              <Badge variant="default" className="h-1.5 w-1.5 rounded-full p-0 bg-primary" />
                            )}
                          </div>
                          <p className="text-sm text-slate-400 truncate mt-0.5">{n.body}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            {timeAgo(n.createdAt)}
                          </span>
                          <ChevronRight className="h-4 w-4 text-slate-600" />
                        </div>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-slate-400">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
