import { useQuery } from '@tanstack/react-query';
import { api, PLANS, STRIPE_LINKS, type BillingPlan } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check } from 'lucide-react';

function PlanCard({
  plan,
  current,
  onUpgrade,
}: {
  plan: BillingPlan;
  current: string;
  onUpgrade: (name: string) => void;
}) {
  const isCurrent = plan.name === current;
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
          <a
            href={STRIPE_LINKS[plan.name] || '#'}
            className={`block rounded-lg px-6 py-3 text-center text-sm font-semibold transition-colors ${
              plan.highlighted
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10'
            }`}
          >
            {plan.cta}
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export function Billing() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const currentPlan = 'Free'; // Default — will be replaced when plan field exists on user

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
        <CardContent>
          <p className="text-sm text-slate-400">
            {currentPlan === 'Free'
              ? 'You have access for up to 5 users and 3 projects. Upgrade to unlock unlimited projects, configurable workflows, and more.'
              : 'Manage your subscription through the Stripe customer portal.'}
          </p>
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
              onUpgrade={() => {}}
            />
          ))}
        </div>
      </div>

      {/* Billing note */}
      <p className="text-sm text-slate-500 text-center">
        All plans billed annually. 14-day free trial included on Pro and Enterprise.
      </p>
    </div>
  );
}
