import { useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const attempted = useRef(false);

  const verifyMutation = useMutation({
    mutationFn: (t: string) => api.verifyEmail(t),
    onSuccess: () => {
      setTimeout(() => navigate('/dashboard'), 2000);
    },
  });

  useEffect(() => {
    if (token && !attempted.current) {
      attempted.current = true;
      verifyMutation.mutate(token);
    }
  }, [token]);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center mb-2">
              <XCircle className="h-10 w-10 text-red-400" />
            </div>
            <CardTitle>Missing Token</CardTitle>
            <CardDescription>
              No verification token provided. Please check your verification link.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (verifyMutation.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center mb-2">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
            <CardTitle>Verifying your email...</CardTitle>
            <CardDescription>Please wait while we verify your email address.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (verifyMutation.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center mb-2">
              <XCircle className="h-10 w-10 text-red-400" />
            </div>
            <CardTitle>Verification Failed</CardTitle>
            <CardDescription>
              {verifyMutation.error?.message || 'The verification token is invalid or has expired.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-2">
            <CheckCircle className="h-10 w-10 text-emerald-400" />
          </div>
          <CardTitle>Email Verified!</CardTitle>
          <CardDescription>
            Your email has been verified successfully. Redirecting to dashboard...
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
