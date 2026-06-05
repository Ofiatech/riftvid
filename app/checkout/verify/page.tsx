'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, Check, Zap, ArrowRight, Home, AlertCircle, Sparkles, Clock,
} from 'lucide-react';

type ViewState =
  | 'polling'           // Initial: payment confirmed by Flutterwave, waiting for webhook
  | 'verified'          // Success: webhook confirmed, tier + credits granted
  | 'still_pending'     // 30s elapsed, webhook still hasn't arrived (rare, user-facing graceful state)
  | 'cancelled'         // User cancelled on Flutterwave's page
  | 'failed'            // Webhook explicitly marked as failed (or payment provider said failed)
  | 'not_found'         // tx_ref doesn't match — bad redirect or tampered URL
  | 'error';            // Network error talking to our own server

interface VerifyData {
  status: string;
  tier?: string;
  amount?: number;
  currency?: string;
  creditsGranted?: number;
  newBalance?: number;
  billingInterval?: string;
  error?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ───────────────────────────────────────────────────────────────────────────

// Poll every 2s. Webhooks usually arrive within 1-3s of redirect.
const POLL_INTERVAL_MS = 2000;
// Stop polling after 30s. Even slow webhook setups should arrive within 10s.
const MAX_POLL_DURATION_MS = 30_000;
// Calculated for derived state display
const MAX_POLL_ATTEMPTS = MAX_POLL_DURATION_MS / POLL_INTERVAL_MS;

function formatPrice(amount: number, currency: string): string {
  if (currency === 'USD') {
    return amount % 1 === 0 ? `$${amount}` : `$${amount.toFixed(2)}`;
  }
  if (currency === 'NGN') {
    return `₦${amount.toLocaleString('en-NG')}`;
  }
  return `${amount} ${currency}`;
}

function tierLabel(tier: string | undefined): string {
  switch (tier) {
    case 'creator': return 'Creator';
    case 'pro': return 'Pro';
    case 'studio': return 'Studio';
    default: return tier || 'tier';
  }
}

// ───────────────────────────────────────────────────────────────────────────
// VERIFY CONTENT
// ───────────────────────────────────────────────────────────────────────────

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Flutterwave returns these on redirect back to our verify URL:
  //   ?tx_ref=xxx&transaction_id=NNN&status=successful|cancelled|failed
  const txRef = searchParams.get('tx_ref');
  const flwStatus = searchParams.get('status');

  // ─── Determine initial state from URL ─────────────────────────────────
  // If user hit "Cancel" on Flutterwave's page, the redirect arrives with
  // status=cancelled. No reason to poll — just show the cancelled state.
  const initialState: ViewState =
    flwStatus === 'cancelled'
      ? 'cancelled'
      : !txRef
      ? 'not_found'
      : 'polling';

  const [viewState, setViewState] = useState<ViewState>(initialState);
  const [data, setData] = useState<VerifyData | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [countdown, setCountdown] = useState(5);

  // Refs for cleanup. We use refs (not state) so the polling loop doesn't
  // re-trigger when these change — it just reads the latest values.
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const mountedRef = useRef(true);

  // ─── POLLING LOOP ─────────────────────────────────────────────────────
  useEffect(() => {
    if (viewState !== 'polling' || !txRef) return;

    mountedRef.current = true;
    startTimeRef.current = Date.now();

    async function pollOnce() {
      if (!mountedRef.current) return;

      try {
        const res = await fetch(`/api/checkout/verify?tx_ref=${encodeURIComponent(txRef!)}`);
        const json: VerifyData = await res.json();

        if (!mountedRef.current) return;

        setData(json);
        setPollAttempt((n) => n + 1);

        if (json.status === 'verified') {
          setViewState('verified');
          return; // Stop polling
        }

        if (json.status === 'failed') {
          setViewState('failed');
          return; // Stop polling
        }

        if (json.status === 'not_found') {
          setViewState('not_found');
          return;
        }

        // status === 'pending' — webhook hasn't fired yet.
        // Check if we've exceeded our timeout budget.
        const elapsed = Date.now() - startTimeRef.current;
        if (elapsed >= MAX_POLL_DURATION_MS) {
          setViewState('still_pending');
          return;
        }

        // Schedule next poll
        pollTimeoutRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
      } catch (err) {
        console.error('[Verify] Poll error:', err);
        // Don't bail out on a single network error — keep trying until timeout
        const elapsed = Date.now() - startTimeRef.current;
        if (elapsed >= MAX_POLL_DURATION_MS) {
          if (mountedRef.current) setViewState('error');
          return;
        }
        if (mountedRef.current) {
          pollTimeoutRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
        }
      }
    }

    pollOnce();

    return () => {
      mountedRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [viewState, txRef]);

  // ─── AUTO-REDIRECT ON SUCCESS ─────────────────────────────────────────
  useEffect(() => {
    if (viewState !== 'verified') return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          router.push('/');
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [viewState, router]);

  // ─── DERIVED VALUES ───────────────────────────────────────────────────
  const tierName = tierLabel(data?.tier);
  const priceStr = data?.amount && data?.currency ? formatPrice(data.amount, data.currency) : null;

  return (
    <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-purple-500/10 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-blue-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* ─── POLLING (waiting for webhook) ──────────────────────── */}
        {viewState === 'polling' && (
          <div className="rounded-2xl border border-[#1f2937] bg-[#0a0a0b] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-7 h-7 text-purple-300 animate-spin" strokeWidth={2} />
            </div>
            <h1 className="text-[20px] font-semibold text-white mb-2">
              Confirming your payment
            </h1>
            <p className="text-[13px] text-zinc-400 mb-4">
              Flutterwave has accepted your payment. We&apos;re activating your account now — this usually takes a few seconds.
            </p>
            {/* Progress hint */}
            <div className="w-full max-w-[200px] mx-auto h-1 rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-400 to-blue-400 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (pollAttempt / MAX_POLL_ATTEMPTS) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* ─── VERIFIED (success!) ──────────────────────────────── */}
        {viewState === 'verified' && (
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] to-purple-500/[0.04] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
              <Check className="w-7 h-7 text-emerald-300" strokeWidth={2.5} />
            </div>

            <h1 className="text-[22px] font-semibold text-white mb-2">
              Welcome to {tierName}!
            </h1>
            <p className="text-[13px] text-zinc-400 mb-6">
              {data?.billingInterval === 'monthly'
                ? `Your subscription is live. Your card will auto-renew monthly until you cancel.`
                : `You have 30 days of ${tierName} access. Credits never expire.`}
            </p>

            {/* Credits granted card */}
            {data?.creditsGranted !== undefined && data.creditsGranted > 0 && (
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/[0.05] p-4 mb-3">
                <div className="flex items-center justify-center gap-2 text-[13px] text-zinc-400 mb-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/50" strokeWidth={2} />
                  Credits added
                </div>
                <div className="text-[32px] font-bold bg-gradient-to-r from-purple-300 to-blue-300 bg-clip-text text-transparent">
                  +{data.creditsGranted}
                </div>
                {data.newBalance !== undefined && (
                  <div className="text-[12px] text-zinc-500 mt-1">
                    New balance: <span className="text-zinc-300 font-medium">{data.newBalance} credits</span>
                  </div>
                )}
              </div>
            )}

            {/* Payment confirmation */}
            {priceStr && (
              <div className="text-[11px] text-zinc-500 mb-6 flex items-center justify-center gap-1.5">
                <Check className="w-3 h-3 text-emerald-400" strokeWidth={2.5} />
                Payment of {priceStr} confirmed
              </div>
            )}

            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[14px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
            >
              <Sparkles className="w-4 h-4" strokeWidth={2.25} />
              Start creating
              <ArrowRight className="w-4 h-4" strokeWidth={2.25} />
            </Link>

            <p className="text-[11px] text-zinc-500 mt-4">
              Redirecting in {countdown}s...
            </p>
          </div>
        )}

        {/* ─── STILL PENDING (30s elapsed, no webhook yet) ───────────── */}
        {viewState === 'still_pending' && (
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.06] to-orange-500/[0.04] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-7 h-7 text-amber-300" strokeWidth={2} />
            </div>
            <h1 className="text-[20px] font-semibold text-white mb-2">
              Taking longer than usual
            </h1>
            <p className="text-[13px] text-zinc-400 mb-2">
              Your payment went through, but our system is taking a moment to activate your account.
            </p>
            <p className="text-[13px] text-zinc-400 mb-6">
              Your tier and credits will appear in your dashboard within a few minutes. You can safely close this page.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white text-[13px] font-medium transition-all"
              >
                <Loader2 className="w-3.5 h-3.5" strokeWidth={2} />
                Check again
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold transition-all"
              >
                <Home className="w-3.5 h-3.5" strokeWidth={2} />
                Go to dashboard
              </Link>
            </div>
          </div>
        )}

        {/* ─── CANCELLED (user backed out on Flutterwave's page) ───── */}
        {viewState === 'cancelled' && (
          <div className="rounded-2xl border border-[#1f2937] bg-[#0a0a0b] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-500/15 border border-zinc-500/30 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-7 h-7 text-zinc-300" strokeWidth={2} />
            </div>
            <h1 className="text-[20px] font-semibold text-white mb-2">
              Payment cancelled
            </h1>
            <p className="text-[13px] text-zinc-400 mb-6">
              No worries — no charge was made. You can try again whenever you&apos;re ready.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white text-[13px] font-medium transition-all"
              >
                <Home className="w-3.5 h-3.5" strokeWidth={2} />
                Back home
              </Link>
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold transition-all"
              >
                Try again
              </Link>
            </div>
          </div>
        )}

        {/* ─── FAILED / NOT_FOUND / ERROR (real problems) ───────────── */}
        {(viewState === 'failed' ||
          viewState === 'not_found' ||
          viewState === 'error') && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-7 h-7 text-rose-300" strokeWidth={2} />
            </div>
            <h1 className="text-[20px] font-semibold text-white mb-2">
              {viewState === 'not_found'
                ? 'Payment record not found'
                : 'Payment didn\u2019t go through'}
            </h1>
            <p className="text-[13px] text-zinc-400 mb-6">
              {data?.error ||
                (viewState === 'not_found'
                  ? 'We couldn\u2019t find a record of this payment. If you were charged, please contact support.'
                  : 'We could not verify your payment. If you were charged, your card will be refunded automatically.')}
            </p>
            <div className="flex items-center justify-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white text-[13px] font-medium transition-all"
              >
                <Home className="w-3.5 h-3.5" strokeWidth={2} />
                Back home
              </Link>
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold transition-all"
              >
                Try again
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// PAGE WRAPPER
// ───────────────────────────────────────────────────────────────────────────

export default function CheckoutVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#050505] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" strokeWidth={2} />
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}

// === END OF FILE — if you can see this line, the file saved completely ===
