'use client';

import { useState, useEffect } from 'react';
import {
  X, Sparkles, Check, Zap, Loader2, CreditCard, Crown,
  Film, ChevronRight, AlertCircle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// TIER DISPLAY METADATA
// ─────────────────────────────────────────────────────────────────────────
// Display-only. Server-canonical pricing lives in lib/flutterwave.ts —
// when prices change, update both this file AND lib/flutterwave.ts together.
// The server price always wins at checkout, so a mismatch would charge the
// user the server price but show the frontend price. Keep them in sync.

type Tier = 'creator' | 'pro' | 'studio';
type Currency = 'USD' | 'NGN';
type Billing = 'monthly' | 'one_time';

interface TierDisplay {
  id: Tier;
  name: string;
  tagline: string;
  pricing: Record<Currency, number>;
  credits: number;
  features: string[];
  popular?: boolean;
}

const TIERS: TierDisplay[] = [
  {
    id: 'creator',
    name: 'Creator',
    tagline: 'For solo creators',
    pricing: { USD: 9.99, NGN: 14000 },
    credits: 50,
    features: ['50 credits monthly', 'Export videos', 'Audio + lip-sync'],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Most popular',
    pricing: { USD: 29.99, NGN: 42000 },
    credits: 200,
    features: ['200 credits monthly', 'Everything in Creator', 'Premium models'],
    popular: true,
  },
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'For serious storytellers',
    pricing: { USD: 99, NGN: 140000 },
    credits: 800,
    features: ['800 credits monthly', 'Everything in Pro', 'Episode mode (coming soon)'],
  },
];

function formatPrice(amount: number, currency: Currency): string {
  if (currency === 'USD') {
    // $9.99, $29.99, $99
    return amount % 1 === 0 ? `$${amount}` : `$${amount.toFixed(2)}`;
  }
  // ₦14,000 etc — thousands separator, no decimals
  return `₦${amount.toLocaleString('en-NG')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────

interface TierPickerModalProps {
  open: boolean;
  onClose: () => void;
  currentTier?: string | null; // 'free' | 'creator' | etc — to mark current plan
}

export default function TierPickerModal({ open, onClose, currentTier }: TierPickerModalProps) {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [billing, setBilling] = useState<Billing>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoChecked, setGeoChecked] = useState(false);

  // ─── Auto-detect currency from user's region on first open ─────────────
  useEffect(() => {
    if (!open || geoChecked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/checkout', { method: 'GET' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && (data.currency === 'USD' || data.currency === 'NGN')) {
          setCurrency(data.currency);
        }
      } catch {
        // Default already 'USD' — silent fallback
      } finally {
        if (!cancelled) setGeoChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, geoChecked]);

  // ─── Reset transient state when modal closes ──────────────────────────
  useEffect(() => {
    if (!open) {
      setSelectedTier(null);
      setBilling('monthly');
      setLoading(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const selectedTierData = TIERS.find((t) => t.id === selectedTier);
  const selectedPrice = selectedTierData ? selectedTierData.pricing[currency] : 0;

  async function handleContinue() {
    if (!selectedTier) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: selectedTier,
          currency,
          billing,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.paymentLink) {
        throw new Error(data.error || 'Could not start checkout');
      }
      // Hand off to Flutterwave hosted checkout
      window.location.href = data.paymentLink;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      onClick={loading ? undefined : onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-backdrop-in" />

      <div
        className="
          relative w-full max-w-md lg:max-w-lg max-h-[92vh] overflow-y-auto
          bg-[#0a0a0b] border-t border-x border-[#1f2937] rounded-t-2xl
          lg:border lg:rounded-2xl
          shadow-2xl animate-modal-in
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative purple glow */}
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-purple-500/20 blur-[80px] opacity-50 pointer-events-none" />

        <div className="relative px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
          {/* ─── Header ────────────────────────────────────────────── */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-2">
                <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                Upgrade
              </div>
              <h2 className="text-[22px] font-semibold text-white tracking-tight">
                Choose your plan
              </h2>
              <p className="text-[13px] text-zinc-400 mt-1">
                Pick a tier. Pay in USD or Naira. Cancel anytime.
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors disabled:opacity-40"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          {/* ─── Currency toggle ──────────────────────────────────── */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Currency
              </span>
            </div>
            <div className="flex p-1 rounded-xl bg-white/[0.03] border border-[#1f2937]">
              {(['USD', 'NGN'] as Currency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  disabled={loading}
                  className={`flex-1 py-2 px-3 rounded-lg text-[13px] font-medium transition-all ${
                    currency === c
                      ? 'bg-gradient-to-b from-purple-500/30 to-purple-500/10 text-white border border-purple-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-white border border-transparent'
                  }`}
                >
                  {c === 'USD' ? '🇺🇸 US Dollar' : '🇳🇬 Nigerian Naira'}
                </button>
              ))}
            </div>
          </div>

          {/* ─── Tier cards ───────────────────────────────────────── */}
          <div className="mb-5">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
              Plan
            </span>
            <div className="space-y-2.5">
              {TIERS.map((t) => {
                const isSelected = selectedTier === t.id;
                const isCurrent = currentTier === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => !loading && setSelectedTier(t.id)}
                    disabled={loading || isCurrent}
                    className={`
                      relative w-full text-left rounded-xl border p-4 transition-all
                      ${isSelected
                        ? 'border-purple-500/50 bg-gradient-to-br from-purple-500/[0.1] to-blue-500/[0.04] ring-2 ring-purple-500/20'
                        : 'border-[#1f2937] bg-white/[0.02] hover:border-[#2d3748] hover:bg-white/[0.04]'
                      }
                      ${isCurrent ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                  >
                    {/* Popular badge */}
                    {t.popular && !isCurrent && (
                      <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 text-white text-[9px] font-semibold uppercase tracking-wider shadow-lg shadow-purple-500/30">
                        Most popular
                      </div>
                    )}
                    {isCurrent && (
                      <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[9px] font-semibold uppercase tracking-wider">
                        Current plan
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          isSelected
                            ? 'bg-purple-500/20 border border-purple-500/30'
                            : 'bg-white/[0.04] border border-white/[0.06]'
                        }`}>
                          {t.id === 'creator' && <Film className="w-4 h-4 text-purple-300" strokeWidth={1.75} />}
                          {t.id === 'pro' && <Sparkles className="w-4 h-4 text-purple-300" strokeWidth={1.75} />}
                          {t.id === 'studio' && <Crown className="w-4 h-4 text-purple-300" strokeWidth={1.75} />}
                        </div>
                        <div>
                          <div className="text-[15px] font-semibold text-white">{t.name}</div>
                          <div className="text-[11px] text-zinc-500">{t.tagline}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[18px] font-bold text-white leading-none tabular-nums">
                          {formatPrice(t.pricing[currency], currency)}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          / {billing === 'monthly' ? 'month' : '30 days'}
                        </div>
                      </div>
                    </div>

                    <ul className="space-y-1 mt-3">
                      {t.features.map((f, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-[12px] text-zinc-300">
                          <Check className="w-3 h-3 text-purple-300 shrink-0" strokeWidth={2.5} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>

                    {isSelected && (
                      <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center shadow-lg shadow-purple-500/40">
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── Billing toggle ───────────────────────────────────── */}
          <div className="mb-5">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
              Billing
            </span>
            <div className="space-y-2">
              <button
                onClick={() => !loading && setBilling('monthly')}
                disabled={loading}
                className={`w-full text-left rounded-xl border p-3.5 transition-all flex items-center gap-3 ${
                  billing === 'monthly'
                    ? 'border-purple-500/40 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.03]'
                    : 'border-[#1f2937] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  billing === 'monthly' ? 'border-purple-400' : 'border-zinc-600'
                }`}>
                  {billing === 'monthly' && <div className="w-2.5 h-2.5 rounded-full bg-purple-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-white">Monthly subscription</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Renews automatically. Credits roll over. Cancel anytime.
                  </div>
                </div>
              </button>

              <button
                onClick={() => !loading && setBilling('one_time')}
                disabled={loading}
                className={`w-full text-left rounded-xl border p-3.5 transition-all flex items-center gap-3 ${
                  billing === 'one_time'
                    ? 'border-purple-500/40 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.03]'
                    : 'border-[#1f2937] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  billing === 'one_time' ? 'border-purple-400' : 'border-zinc-600'
                }`}>
                  {billing === 'one_time' && <div className="w-2.5 h-2.5 rounded-full bg-purple-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-white">One-time (30 days)</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Pay once. 30 days access. Credits keep forever.
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* ─── Error ─────────────────────────────────────────────── */}
          {error && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" strokeWidth={2} />
              <div className="text-[12px] text-rose-200">{error}</div>
            </div>
          )}
        </div>

        {/* ─── Sticky CTA bar ─────────────────────────────────────── */}
        <div className="sticky bottom-0 left-0 right-0 px-5 py-4 sm:px-6 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b] to-[#0a0a0b]/95 border-t border-[#141821] backdrop-blur-xl">
          {selectedTierData ? (
            <button
              onClick={handleContinue}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[14px] font-semibold shadow-lg shadow-purple-500/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.25} />
                  Redirecting to Flutterwave…
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" strokeWidth={2.25} />
                  Continue to checkout — {formatPrice(selectedPrice, currency)}
                  <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
                </>
              )}
            </button>
          ) : (
            <div className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-[#1f2937] text-center text-[13px] text-zinc-500">
              Pick a plan above to continue
            </div>
          )}
          <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[10px] text-zinc-500">
            <Zap className="w-3 h-3 text-amber-400 fill-amber-400/40" strokeWidth={2} />
            <span>Secure payment via Flutterwave · Refunds within 24h if you don't generate</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// === END OF FILE — if you can see this line, the file saved completely ===
