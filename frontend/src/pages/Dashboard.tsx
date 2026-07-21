import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Clock, Inbox, Loader2, Mail, RefreshCw } from 'lucide-react';

export function Dashboard() {
  const queryClient = useQueryClient();
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    staleTime: 5 * 60 * 1000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: api.getDashboardStats,
    staleTime: 30 * 1000,
  });

  const resendMutation = useMutation({
    mutationFn: () => api.resendVerification(),
    onSuccess: (data) => {
      // Store the new token for display
      setResendToken(data.verificationToken);
    },
  });

  const [resendToken, setResendToken] = useState<string | null>(null);

  if (userLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const statCards = [
    {
      title: 'Total Tickets',
      value: stats?.totalTickets ?? 0,
      icon: Inbox,
      color: 'text-blue-400',
      bgColor: 'bg-blue-400/10',
    },
    {
      title: 'Open',
      value: stats?.ticketsByStatus?.OPEN ?? 0,
      icon: AlertCircle,
      color: 'text-red-400',
      bgColor: 'bg-red-400/10',
    },
    {
      title: 'In Progress',
      value: stats?.ticketsByStatus?.IN_PROGRESS ?? 0,
      icon: Clock,
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-400/10',
    },
    {
      title: 'Verified',
      value: stats?.ticketsByStatus?.VERIFIED ?? 0,
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-400/10',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </h1>
        <p className="text-slate-400 mt-1">Here&apos;s what&apos;s happening with your projects.</p>
      </div>

      {/* Verification banner for unverified users */}
      {user && !user.emailVerified && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 p-4">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300">
                Verify your email to unlock all features
              </p>
              <p className="text-sm text-amber-400/70 mt-1">
                You need to verify your email before you can create projects or tickets.
              </p>
              {resendToken && (
                <div className="mt-2 rounded bg-background/50 px-3 py-2">
                  <p className="text-xs text-slate-400 mb-1">New verification token:</p>
                  <code className="text-xs font-mono text-slate-200 break-all">{resendToken}</code>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => resendMutation.mutate()}
              disabled={resendMutation.isPending}
              className="shrink-0 border-amber-700 text-amber-300 hover:bg-amber-900/30"
            >
              {resendMutation.isPending ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3 w-3" />
              )}
              Resend
            </Button>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-400">{card.title}</CardTitle>
              <div className={`rounded-lg p-2 ${card.bgColor}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {stats?.recentActivity && stats.recentActivity.length > 0 ? (
            <div className="space-y-4">
              {stats.recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-center gap-3 text-sm">
                  <Badge variant="outline" className="shrink-0">
                    {activity.action}
                  </Badge>
                  <span className="text-slate-400">
                    {activity.ticket?.title || 'Unknown ticket'}
                  </span>
                  <span className="text-slate-600 ml-auto text-xs">
                    {new Date(activity.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">
              No recent activity. Create your first ticket to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
