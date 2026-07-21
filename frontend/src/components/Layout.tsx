import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Notification, type NotificationType } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  LayoutDashboard,
  FolderKanban,
  Settings,
  LogOut,
  Bug,
  Building,
  Bell,
  UserCheck,
  ArrowRightLeft,
  AtSign,
  MessageSquare,
  UserPlus,
  ChevronRight,
} from 'lucide-react';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/organization', label: 'Organization', icon: Building },
  { to: '/settings', label: 'Settings', icon: Settings },
];

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

function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: unread } = useQuery({
    queryKey: ['unreadCount'],
    queryFn: api.getUnreadCount,
    refetchInterval: 30_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => api.getNotifications({ pageSize: 5 }),
    staleTime: 15_000,
  });

  const count = unread?.count ?? 0;
  const notifications = recent?.notifications ?? [];

  const handleClick = async (n: Notification) => {
    if (!n.read) {
      await api.markRead(n.id);
      queryClient.invalidateQueries({ queryKey: ['unreadCount'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.ticketId) {
      navigate(`/tickets/${n.ticketId}`);
    } else if (n.projectId) {
      navigate(`/projects/${n.projectId}`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5 text-slate-400" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold text-slate-200">Notifications</span>
          {count > 0 && (
            <span className="text-xs text-slate-400">{count} unread</span>
          )}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-slate-500">
            No notifications yet
          </div>
        ) : (
          notifications.map((n) => {
            const Icon = typeIcons[n.type] || Bell;
            const colorClass = typeColors[n.type] || 'text-slate-400';
            return (
              <DropdownMenuItem
                key={n.id}
                onClick={() => handleClick(n)}
                className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer ${
                  !n.read ? 'bg-primary/5' : ''
                }`}
              >
                <div className={`mt-0.5 shrink-0 ${colorClass}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${!n.read ? 'text-slate-100 font-medium' : 'text-slate-300'}`}>
                    {n.title}
                  </p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{n.body}</p>
                  <p className="text-[11px] text-slate-600 mt-1">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && (
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                )}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate('/notifications')}
          className="justify-center text-sm text-primary cursor-pointer font-medium"
        >
          View all notifications
          <ChevronRight className="ml-1 h-4 w-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout() {
  const navigate = useNavigate();
  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2 px-4 border-b border-border">
          <Bug className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold text-foreground">TrackQA</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-slate-400 hover:bg-secondary hover:text-slate-200'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <Separator />

        {/* User menu */}
        <div className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-3 px-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/20 text-primary text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start text-sm">
                  <span className="font-medium text-slate-200">
                    {user?.name || 'Loading...'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {user?.email || ''}
                  </span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-400">
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {/* Top bar with notification bell */}
        <div className="flex items-center justify-end h-14 px-6 border-b border-border bg-card/50">
          <NotificationBell />
        </div>
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
