import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, PLANS, type BillingPlan } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check } from 'lucide-react';

function PlanCard({
  plan,
  current,
  onUpgrade,
  loading,
}: {
  plan: BillingPlan;
  current: string;
  onUpgrade: (name: string) => void;
  loading: boolean;
}) {
  const isCurrent = plan.name.toLowerCase() === current.toLowerCase();
  const isFree = plan.name === 'Free';

  return (
    <Card
      className={`relative flex flex-col ${
        plan.highlighted
          ? 'border-emerald-500/50 ring-1 ring-emerald-500/20'
          : 'border-border'
      }`}
    >
      {plan.highlighted && (
        <div className="absolute -top-3 left-0 right-0 mx-auto w-fit rounded-full bg-emerald-500 px-3 py-0.5 text-xs font-semibold text-slate-950">
          Most Popular
        </div>
      )}

      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{plan.name}</CardTitle>
          {isCurrent && <Badge className="bg-primary/20 text-primary border-primary/30">Current Plan</Badge>}
        </div>
        <CardDescription>{plan.description}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col space-y-6">
        {/* Price */}
        <div>
          <span className="text-3xl font-bold text-foreground">{plan.price}</span>
          <span className="text-sm text-slate-400"> /{plan.period}</span>
        </div>

        {/* Features */}
        <ul className="flex-1 space-y-2.5">
          {plan.features.map((feat) => (
            <li key={feat} className="flex items-start gap-2.5 text-sm text-slate-300">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              {feat}
            </li>
          ))}
        </ul>

        {/* CTA */}
        {isCurrent ? (
          <div className="rounded-lg border border-border px-6 py-3 text-center text-sm font-semibold text-slate-400">
            Current Plan
          </div>
        ) : isFree ? (
          <div className="rounded-lg border border-border px-6 py-3 text-center text-sm font-semibold text-slate-400">
            {plan.cta}
          </div>
        ) : (
          <button
            onClick={() => onUpgrade(plan.name)}
            disabled={loading}
            className={`block w-full rounded-lg px-6 py-3 text-center text-sm font-semibold transition-colors ${
              plan.highlighted
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10'
            }`}
          >
            {loading ? 'Redirecting...' : plan.cta}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

export function Billing() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    staleTime: 5 * 60 * 1000,
  });

  const { data: planData } = useQuery({
    queryKey: ['billing-plan'],
    queryFn: api.getPlan,
    staleTime: 60 * 1000,
  });

  const checkoutMutation = useMutation({
    mutationFn: (priceId: string) => api.createCheckoutSession(priceId),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: () => {
      setLoadingPlan(null);
    },
  });

  const portalMutation = useMutation({
    mutationFn: () => api.createPortalSession(),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const handleUpgrade = (planName: string) => {
    setLoadingPlan(planName);
    // Price IDs are fetched dynamically from the server via /api/billing/plan response
    // For now, we tell the backend which plan via a separate endpoint,
    // but since we need priceId, we use a convention: "pro" → pro price, "enterprise" → enterprise price
    const priceId = planName === 'Pro' ? 'pro' : 'enterprise';
    checkoutMutation.mutate(priceId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const currentPlan = (planData?.plan || user?.plan || 'Free').charAt(0).toUpperCase() + (planData?.plan || user?.plan || 'free').slice(1);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Billing & Plans</h1>
        <p className="text-slate-400 mt-1">
          Manage your subscription and view available plans.
        </p>
      </div>

      {/* Current plan summary */}
      <Card>
        <CardHeader>
          <CardTitle>Your Plan</CardTitle>
          <CardDescription>
            You are currently on the <span className="font-semibold text-foreground">{currentPlan}</span> plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-400">
            {currentPlan === 'Free'
              ? 'You have access for up to 5 users and 3 projects. Upgrade to unlock unlimited projects, configurable workflows, and more.'
              : 'Manage your subscription through the Stripe customer portal.'}
          </p>
          {currentPlan !== 'Free' && planData?.stripeCustomerId && (
            <button
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="inline-flex items-center rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
            >
              {portalMutation.isPending ? 'Loading...' : 'Manage Subscription'}
            </button>
          )}
        </CardContent>
      </Card>

      {/* Plan comparison */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">Available Plans</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.name}
              plan={plan}
              current={currentPlan}
              onUpgrade={handleUpgrade}
              loading={loadingPlan === plan.name}
            />
          ))}
        </div>
      </div>

      {/* Billing note */}
      <p className="text-sm text-slate-500 text-center">
        All plans billed monthly. 14-day free trial included on Pro and Enterprise.
      </p>
    </div>
  );
}
