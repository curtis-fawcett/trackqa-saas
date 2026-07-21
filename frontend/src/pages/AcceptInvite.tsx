import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, Mail, Building, FolderKanban, AlertCircle, LogIn } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const tokenValue = localStorage.getItem('token');

  const { data: invite, isLoading, isError } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.getInvite(token!),
    enabled: !!token,
  });

  const acceptMutation = useMutation({
    mutationFn: () => api.acceptInvite(token!),
    onSuccess: () => {
      navigate('/dashboard');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleAccept = () => {
    setError('');
    acceptMutation.mutate();
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <p className="text-slate-400">Invalid invitation link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <p className="text-slate-400">This invitation is invalid or has expired.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const targetName = invite.organization?.name || invite.project?.name || 'Unknown';
  const targetType = invite.organization ? 'organization' : 'project';
  const Icon = invite.organization ? Building : FolderKanban;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-xl">You've been invited!</CardTitle>
          <CardDescription>
            Join {targetName} on TrackQA
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-slate-800/50 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Icon className="h-5 w-5 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-200">{targetName}</p>
                <p className="text-xs text-slate-500 capitalize">{targetType}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                {ROLE_LABELS[invite.role] || invite.role}
              </Badge>
              <span className="text-xs text-slate-500">role</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Invited by</span>
              <span className="text-slate-300">{invite.invitedBy?.name || invite.invitedBy?.email || 'Unknown'}</span>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}

          {tokenValue ? (
            <Button
              className="w-full"
              onClick={handleAccept}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Accepting...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Accept Invitation
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-sm text-slate-400">
                You need to log in or create an account to accept this invitation.
              </p>
              <div className="flex gap-2">
                <Button className="flex-1" asChild>
                  <Link to={`/login?redirect=/invite/${token}`}>
                    <LogIn className="h-4 w-4 mr-2" />
                    Log In
                  </Link>
                </Button>
                <Button className="flex-1" variant="outline" asChild>
                  <Link to={`/register?redirect=/invite/${token}`}>
                    Register
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
