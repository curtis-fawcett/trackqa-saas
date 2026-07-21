import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { Loader2, UserPlus, X, Mail, Shield, Clock, Building } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-yellow-900/50 text-yellow-300 border-yellow-800',
  ADMIN: 'bg-purple-900/50 text-purple-300 border-purple-800',
  MEMBER: 'bg-slate-700/50 text-slate-300 border-slate-600',
};

function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function OrgSettings() {
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [error, setError] = useState('');

  // For simplicity, use the first organization. In production, would have org selector.
  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: api.getOrganizations,
  });

  const orgId = orgs?.[0]?.id;

  const { data: org } = useQuery({
    queryKey: ['organization', orgId],
    queryFn: () => api.getOrganization(orgId!),
    enabled: !!orgId,
  });

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => api.getOrgMembers(orgId!),
    enabled: !!orgId,
  });

  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ['org-invites', orgId],
    queryFn: () => api.getOrgInvites(orgId!),
    enabled: !!orgId,
  });

  const createInvite = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api.createOrgInvite(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-invites', orgId] });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      setError('');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => api.cancelInvite(inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-invites', orgId] });
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    createInvite.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  if (!orgId) {
    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Organization Settings</h1>
          <p className="text-slate-400 mt-1">Manage your organization members and invites.</p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building className="h-12 w-12 text-slate-600 mb-4" />
            <CardTitle className="text-lg text-slate-400 mb-2">No organization yet</CardTitle>
            <p className="text-sm text-slate-600 max-w-sm">
              Create an organization to start inviting team members.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Organization Settings</h1>
          <p className="text-slate-400 mt-1">
            {org?.name || 'Organization'} — Manage members and invites.
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>
                Send an invitation to join {org?.name || 'this organization'}.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleInvite}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => { setInviteEmail(e.target.value); setError(''); }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MEMBER">Member</SelectItem>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="OWNER">Owner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {error && (
                  <p className="text-sm text-red-400">{error}</p>
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
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-400" />
            Members
          </CardTitle>
          <CardDescription>
            {members?.length ?? 0} member{(members?.length ?? 0) !== 1 ? 's' : ''} in this organization
          </CardDescription>
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
                        {initials(member.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium text-slate-200">
                        {member.user.name || 'Unknown'}
                      </p>
                      <p className="text-xs text-slate-500">{member.user.email}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={ROLE_COLORS[member.role] || 'border-slate-600 text-slate-400'}>
                    {ROLE_LABELS[member.role] || member.role}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 py-4 text-center">No members found.</p>
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
                        <span>{ROLE_LABELS[invite.role] || invite.role}</span>
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
  );
}
