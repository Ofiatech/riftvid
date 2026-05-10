'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Check, Zap, ArrowRight, Home, AlertCircle } from 'lucide-react';

type VerifyStatus = 'verifying' | 'success' | 'already_completed' | 'processing' | 'failed' | 'error';

interface VerifyResult {
  status: VerifyStatus;
  credits_added?: number;
  new_balance?: number;
  amount?: number;
  currency?: string;
  message?: string;
  error?: string;
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reference = searchParams.get('reference');

  const [result, setResult] = useState<VerifyResult>({ status: 'verifying' });
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!reference) {
      setResult({ status: 'error', error: 'No payment reference found' });
      return;
    }

    async function verify() {
      try {
        const res = await fetch(`/api/checkout/verify?reference=${reference}`);
        const data = await res.json();

        if (!res.ok) {
          setResult({
            status: data.status || 'error',
            error: data.error || 'Verification failed',
          });
          return;
        }

        setResult(data);
      } catch (err) {
        setResult({
          status: 'error',
          error: err instanceof Error ? err.message : 'Network error',
        });
      }
    }

    verify();
  }, [reference]);

  // Auto-redirect on success
  useEffect(() => {
    if (result.status === 'success' || result.status === 'already_completed') {
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
    }
  }, [result.status, router]);

  const isSuccess = result.status === 'success' || result.status === 'already_completed';

  return (
    <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-purple-500/10 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-blue-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* VERIFYING */}
        {result.status === 'verifying' && (
          <div className="rounded-2xl border border-[#1f2937] bg-[#0a0a0b] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-7 h-7 text-purple-300 animate-spin" strokeWidth={2} />
            </div>
            <h1 className="text-[20px] font-semibold text-white mb-2">Confirming your payment</h1>
            <p className="text-[13px] text-zinc-400">
              We&apos;re verifying your transaction with Korapay. This takes just a moment...
            </p>
          </div>
        )}

        {/* SUCCESS */}
        {isSuccess && (
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] to-purple-500/[0.04] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
              <Check className="w-7 h-7 text-emerald-300" strokeWidth={2.5} />
            </div>

            <h1 className="text-[22px] font-semibold text-white mb-2">
              {result.status === 'already_completed' ? 'Already credited' : 'Payment successful!'}
            </h1>
            <p className="text-[13px] text-zinc-400 mb-6">
              {result.status === 'already_completed'
                ? 'These credits were already added to your account.'
                : 'Your credits have been added. Time to create something amazing.'}
            </p>

            {result.credits_added !== undefined && (
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/[0.05] p-4 mb-6">
                <div className="flex items-center justify-center gap-2 text-[13px] text-zinc-400 mb-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/50" strokeWidth={2} />
                  Credits added
                </div>
                <div className="text-[32px] font-bold bg-gradient-to-r from-purple-300 to-blue-300 bg-clip-text text-transparent">
                  +{result.credits_added}
                </div>
                {result.new_balance !== undefined && (
                  <div className="text-[12px] text-zinc-500 mt-1">
                    New balance: <span className="text-zinc-300 font-medium">{result.new_balance} credits</span>
                  </div>
                )}
              </div>
            )}

            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[14px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
            >
              Start creating
              <ArrowRight className="w-4 h-4" strokeWidth={2.25} />
            </Link>

            <p className="text-[11px] text-zinc-500 mt-4">
              Redirecting in {countdown}s...
            </p>
          </div>
        )}

        {/* PROCESSING (still pending on Korapay's side) */}
        {result.status === 'processing' && (
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.06] to-orange-500/[0.04] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-7 h-7 text-amber-300 animate-spin" strokeWidth={2} />
            </div>
            <h1 className="text-[20px] font-semibold text-white mb-2">Payment processing</h1>
            <p className="text-[13px] text-zinc-400 mb-6">
              {result.message ||
                'Your payment is still being processed. This can take up to a few minutes for some payment methods.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white text-[14px] font-medium transition-all"
            >
              Check again
            </button>
          </div>
        )}

        {/* FAILED / ERROR */}
        {(result.status === 'failed' || result.status === 'error') && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-7 h-7 text-rose-300" strokeWidth={2} />
            </div>
            <h1 className="text-[20px] font-semibold text-white mb-2">Payment didn&apos;t go through</h1>
            <p className="text-[13px] text-zinc-400 mb-6">
              {result.error || 'We could not verify your payment. No charge was made if no credits were added.'}
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
