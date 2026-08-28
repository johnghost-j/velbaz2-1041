import { useAuth } from '../lib/auth';
import { useLocation } from 'wouter';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { AnimatedCounter } from '../components/AnimatedCounter';

const PLANS = [
  {
    name: 'Free',
    price: '0',
    period: '/mo',
    description: 'Get started with basic features',
    features: ['1 project', 'Basic AI analysis', 'Community support', '100 queries/month'],
    cta: 'Current Plan',
    highlighted: false,
    key: 'free',
  },
  {
    name: 'Business',
    price: '29',
    period: '/mo',
    description: 'For growing teams and businesses',
    features: ['10 projects', 'Advanced AI analysis', 'Priority support', '5,000 queries/month', 'Custom reports', 'Team collaboration'],
    cta: 'Upgrade',
    highlighted: true,
    key: 'business',
  },
  {
    name: 'Enterprise',
    price: '99',
    period: '/mo',
    description: 'For large-scale operations',
    features: ['Unlimited projects', 'Full AI suite', 'Dedicated support', 'Unlimited queries', 'Custom integrations', 'API access', 'SSO & advanced security'],
    cta: 'Contact Us',
    highlighted: false,
    key: 'enterprise',
  },
];

const TOKEN_PACKAGES = [
  // 1 € = 1000 credits
  { id: 'credits_4990', tokens: 4990, price: 4.99, label: '4,990 Credits' },
  { id: 'credits_9990', tokens: 9990, price: 9.99, label: '9,990 Credits' },
  { id: 'credits_24990', tokens: 24990, price: 24.99, label: '24,990 Credits' },
  { id: 'credits_49990', tokens: 49990, price: 49.99, label: '49,990 Credits' },
];


export default function Plans() {
  const { user, updateTokens } = useAuth();
  const [, navigate] = useLocation();
  const currentPlan = user?.plan || 'free';
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);

  async function buyTokens(pkgId: string) {
    setPurchasing(pkgId);
    setPurchaseSuccess(null);
    try {
      const res = await api.tokens.purchase(pkgId);
      if (res.ok) {
        updateTokens(res.tokens);
        const pkg = TOKEN_PACKAGES.find(p => p.id === pkgId);
        setPurchaseSuccess(`${pkg?.tokens} credits added! New balance: ${res.tokens}`);
      } else {
        setPurchaseSuccess(res.error || 'Purchase failed');
      }
    } catch { setPurchaseSuccess('Network error'); }
    setPurchasing(null);
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-0)' }}>
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Choose your plan</h1>
          <p className="text-[14px]" style={{ color: 'var(--text-dim)' }}>Scale your workflow with the right plan for your needs</p>
          {user && (
            <div className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--teal)" strokeWidth="1.5"><circle cx="8" cy="8" r="5" /><path d="M8 5.5V8.5M8 10.5V10.5" strokeLinecap="round" /></svg>
              <span className="text-[13px] font-medium" style={{ color: 'var(--teal)' }}><AnimatedCounter value={user.tokens || 0} fontSize={13} suffix=" credits" /></span>
              <span className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>remaining</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan.toLowerCase() === plan.key;
            return (
              <div key={plan.key} className="rounded-xl p-6 flex flex-col"
                style={{
                  background: 'var(--surface-1)',
                  border: plan.highlighted ? '1px solid var(--teal)' : '1px solid var(--border-subtle)',
                  boxShadow: plan.highlighted ? '0 0 30px rgba(78, 170, 220,0.06)' : 'none',
                }}>
                {plan.highlighted && (
                  <div className="self-start text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full mb-4"
                    style={{ background: 'var(--teal-bg)', color: 'var(--teal)' }}>Popular</div>
                )}

                <h2 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>{plan.name}</h2>
                <div className="flex items-baseline gap-0.5 mb-1">
                  <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>${plan.price}</span>
                  <span className="text-[13px]" style={{ color: 'var(--text-ghost)' }}>{plan.period}</span>
                </div>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-dim)' }}>{plan.description}</p>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 16 16" fill="none"
                        stroke={plan.highlighted ? 'var(--teal)' : 'var(--text-ghost)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                <button disabled={isCurrent}
                  className="w-full h-10 rounded-lg text-[13px] font-medium transition-all"
                  style={
                    isCurrent
                      ? { background: 'var(--surface-3)', color: 'var(--text-ghost)', border: '1px solid var(--border-default)', cursor: 'default' }
                      : plan.highlighted
                        ? { background: 'var(--teal)', color: 'var(--text-inverse)', border: 'none', cursor: 'pointer' }
                        : { background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)', cursor: 'pointer' }
                  }
                  onMouseEnter={(e) => {
                    if (!isCurrent && plan.highlighted) e.currentTarget.style.background = '#3D9DC5';
                    else if (!isCurrent) e.currentTarget.style.background = 'var(--surface-4)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent && plan.highlighted) e.currentTarget.style.background = 'var(--teal)';
                    else if (!isCurrent) e.currentTarget.style.background = 'var(--surface-3)';
                  }}>
                  {isCurrent ? 'Current Plan' : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        {/* Token Purchase Section — only visible for paid plans */}
        {currentPlan !== 'free' && (
          <div className="mt-12">
            <div className="text-center mb-6">
              <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Buy Credits</h2>
              <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
                Top up your credit balance to keep building. €1 = 1,000 credits.
              </p>
            </div>

            {purchaseSuccess && (
              <div className="max-w-2xl mx-auto mb-4 px-4 py-3 rounded-lg text-[13px] text-center"
                style={{ background: purchaseSuccess.includes('added') ? 'var(--green-subtle-bg)' : 'var(--red-subtle-bg)', border: `1px solid ${purchaseSuccess.includes('added') ? 'var(--green-subtle-border)' : 'var(--red-subtle-border)'}`, color: purchaseSuccess.includes('added') ? 'var(--teal)' : 'var(--red-text)' }}>
                {purchaseSuccess}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
              {TOKEN_PACKAGES.map((pkg) => (
                <div key={pkg.id} className="rounded-xl p-5 text-center flex flex-col"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                  <div className="text-2xl font-bold mb-1" style={{ color: 'var(--teal)' }}><AnimatedCounter value={pkg.tokens} fontSize={24} /></div>
                  <div className="text-[11px] mb-3" style={{ color: 'var(--text-dim)' }}>credits</div>
                  <div className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>${pkg.price}</div>
                  <button
                    onClick={() => buyTokens(pkg.id)}
                    disabled={purchasing === pkg.id}
                    className="mt-auto w-full h-9 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
                    onMouseEnter={e => { if (!purchasing) e.currentTarget.style.background = 'var(--surface-4)'; }}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-3)'}>
                    {purchasing === pkg.id ? 'Purchasing...' : 'Buy'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Token Cost Reference — removed */}
      </div>
    </div>
  );
}
