import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Bug, Loader2, CheckCircle, ArrowLeft, KeyRound } from 'lucide-react';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);

  const forgotMutation = useMutation({
    mutationFn: (data: { email: string }) => api.forgotPassword(data.email),
    onSuccess: (data) => {
      if (data.resetToken) {
        setResetToken(data.resetToken);
      }
    },
  });

  if (resetToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-2">
              <KeyRound className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              If an account exists with that email, a reset token has been generated. In development mode, use the token below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-emerald-900/30 border border-emerald-800 px-4 py-3">
              <p className="text-sm text-emerald-300 font-medium mb-2">Reset token:</p>
              <code className="block rounded bg-background/50 px-3 py-2 text-sm font-mono text-slate-200 break-all">
                {resetToken}
              </code>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button className="w-full" asChild>
              <Link to={`/reset-password?token=${resetToken}`}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Go to Reset Password
              </Link>
            </Button>
            <Link
              to="/login"
              className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-primary"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to login
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-2">
            <Bug className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-2xl">Forgot password?</CardTitle>
          <CardDescription>Enter your email and we&apos;ll generate a reset token.</CardDescription>
        </CardHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            forgotMutation.mutate({ email });
          }}
        >
          <CardContent className="space-y-4">
            {forgotMutation.isError && (
              <div className="rounded-md bg-red-900/30 border border-red-800 px-4 py-3 text-sm text-red-300">
                {forgotMutation.error?.message || 'Something went wrong. Please try again.'}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={forgotMutation.isPending}>
              {forgotMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Send Reset Token
            </Button>
            <Link
              to="/login"
              className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-primary"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to login
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
