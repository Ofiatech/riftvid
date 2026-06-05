/**
 * Flutterwave API client + helpers for Riftvid payments.
 *
 * This module is the ONLY place that talks to Flutterwave directly. The API
 * routes (checkout, webhook) import from here. Keeping the surface area
 * concentrated makes auditing easier and reduces the blast radius of bugs.
 *
 * Design notes:
 *  - All amounts are stored as INTEGER cents/kobo in DB, but Flutterwave
 *    expects amounts in major units (dollars, naira) as numbers. We convert
 *    at the boundary.
 *  - Subscription plans are created lazily — on first checkout for a given
 *    (tier × currency × interval) combo. Plan IDs are persisted in the
 *    `payment_plans` table so we never create duplicates.
 *  - Webhook signature is verified by comparing the `verif-hash` header to
 *    our stored FLUTTERWAVE_SECRET_HASH. Constant-time comparison is used
 *    to prevent timing attacks (defense-in-depth — likelihood is low but
 *    free to add).
 */

import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Tier = 'creator' | 'pro' | 'studio';
export type Currency = 'USD' | 'NGN';
export type BillingInterval = 'one_time' | 'monthly';

export interface PricingEntry {
  tier: Tier;
  currency: Currency;
  /** Amount in MAJOR units (dollars / naira), the unit Flutterwave expects. */
  amount: number;
  /** Credits granted on successful payment. */
  credits: number;
  /** Human-readable label for the tier (used in checkout summary). */
  label: string;
}

export interface InitiatePaymentParams {
  userId: string;
  email: string;
  fullName: string;
  tier: Tier;
  currency: Currency;
  billing: BillingInterval;
  /** Our internal transaction reference. Used as `tx_ref` with Flutterwave. */
  txRef: string;
  /** Where to send the user after they pay. */
  redirectUrl: string;
}

export interface InitiatePaymentResult {
  /** The hosted Flutterwave checkout URL the user should be redirected to. */
  paymentLink: string;
}

export interface VerifyTransactionResult {
  verified: boolean;
  /** Flutterwave's permanent transaction ID (different from our tx_ref). */
  flwTxId: number | null;
  amount: number;
  currency: Currency;
  customerEmail: string | null;
  /** Useful for debugging payment failures. */
  status: string;
  rawResponse: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRICING TABLE
// ═══════════════════════════════════════════════════════════════════════════
//
// Single source of truth. Used by the checkout API to validate amounts before
// initiating payment (so a malicious frontend can't request a Studio tier at
// Creator-tier prices), and by the webhook handler to grant credits.
//
// Mirror this in the frontend TierPickerModal — but the server's copy WINS.
// Frontend prices are display-only; backend re-resolves the price at checkout.

export const PRICING: Record<`${Tier}_${Currency}`, PricingEntry> = {
  creator_USD: { tier: 'creator', currency: 'USD', amount: 9.99,  credits: 50,  label: 'Creator' },
  creator_NGN: { tier: 'creator', currency: 'NGN', amount: 14000, credits: 50,  label: 'Creator' },
  pro_USD:     { tier: 'pro',     currency: 'USD', amount: 29.99, credits: 200, label: 'Pro' },
  pro_NGN:     { tier: 'pro',     currency: 'NGN', amount: 42000, credits: 200, label: 'Pro' },
  studio_USD:  { tier: 'studio',  currency: 'USD', amount: 99,    credits: 800, label: 'Studio' },
  studio_NGN:  { tier: 'studio',  currency: 'NGN', amount: 140000, credits: 800, label: 'Studio' },
};

export function getPricing(tier: Tier, currency: Currency): PricingEntry {
  const key = `${tier}_${currency}` as keyof typeof PRICING;
  const entry = PRICING[key];
  if (!entry) {
    throw new Error(`No pricing found for ${tier} in ${currency}`);
  }
  return entry;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENV ACCESS
// ═══════════════════════════════════════════════════════════════════════════

function env(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required env var: ${key}. Set it in .env.local AND Vercel.`
    );
  }
  return value;
}

function getSecretKey(): string {
  return env('FLUTTERWAVE_SECRET_KEY');
}

function getSecretHash(): string {
  return env('FLUTTERWAVE_SECRET_HASH');
}

const FLW_API_BASE = 'https://api.flutterwave.com/v3';

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK SIGNATURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════
//
// Flutterwave sends a `verif-hash` header on every webhook. We must compare
// it to our configured FLUTTERWAVE_SECRET_HASH. If it doesn't match, the
// request is NOT from Flutterwave — reject without processing.

/**
 * Verify that a webhook request came from Flutterwave by comparing the
 * received hash to our configured secret hash. Returns true if valid.
 *
 * Uses crypto.timingSafeEqual to prevent timing attacks (where an attacker
 * could probe one character at a time by measuring response times).
 */
export function verifyWebhookSignature(receivedHash: string | null): boolean {
  if (!receivedHash) return false;
  let expected: string;
  try {
    expected = getSecretHash();
  } catch {
    return false;
  }
  if (receivedHash.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedHash),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT PLANS (for subscriptions only)
// ═══════════════════════════════════════════════════════════════════════════
//
// Flutterwave's recurring billing requires a "payment plan" to exist first.
// We create one per (tier × currency × interval) combination, lazily on
// first checkout. Plan IDs persist in our `payment_plans` table so we never
// duplicate them.

interface PaymentPlanRow {
  id: string;
  tier: Tier;
  currency: Currency;
  interval: string;
  flutterwave_plan_id: number;
  amount: number;
}

interface FlwCreatePlanResponse {
  status: string;
  message: string;
  data: {
    id: number;
    name: string;
    amount: number;
    interval: string;
    status: string;
    currency: string;
  };
}

/**
 * Get the Flutterwave plan_id for a given tier × currency × interval,
 * creating it in Flutterwave + caching the ID in our DB if it doesn't exist.
 *
 * Only used for subscription billing. One-time payments don't need a plan.
 */
async function getOrCreatePaymentPlan(
  tier: Tier,
  currency: Currency,
  interval: 'monthly'
): Promise<number> {
  const supabase = getSupabaseAdmin();

  // Check if we already have a plan for this combo
  const { data: existing } = await supabase
    .from('payment_plans')
    .select('flutterwave_plan_id')
    .eq('tier', tier)
    .eq('currency', currency)
    .eq('interval', interval)
    .maybeSingle();

  if (existing?.flutterwave_plan_id) {
    return existing.flutterwave_plan_id as number;
  }

  // Need to create one. Look up pricing for the amount.
  const pricing = getPricing(tier, currency);

  const planName = `Riftvid ${pricing.label} (${currency} ${interval})`;
  const res = await fetch(`${FLW_API_BASE}/payment-plans`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: pricing.amount,
      name: planName,
      interval, // 'monthly'
      currency,
    }),
  });

  const json = (await res.json()) as FlwCreatePlanResponse;
  if (!res.ok || json.status !== 'success' || !json.data?.id) {
    throw new Error(
      `Flutterwave payment plan create failed: ${json.message || 'unknown error'}`
    );
  }

  const flwPlanId = json.data.id;

  // Cache it. If a concurrent request created the same row, the unique
  // constraint will fail — we re-read in that case.
  const { error: insertErr } = await supabase.from('payment_plans').insert({
    tier,
    currency,
    interval,
    flutterwave_plan_id: flwPlanId,
    amount: pricing.amount,
  });

  if (insertErr) {
    // Race condition — another request beat us. Read what they inserted.
    const { data: raced } = await supabase
      .from('payment_plans')
      .select('flutterwave_plan_id')
      .eq('tier', tier)
      .eq('currency', currency)
      .eq('interval', interval)
      .maybeSingle();
    if (raced?.flutterwave_plan_id) {
      return raced.flutterwave_plan_id as number;
    }
    throw new Error(`Failed to persist payment plan: ${insertErr.message}`);
  }

  return flwPlanId;
}

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT INITIATION
// ═══════════════════════════════════════════════════════════════════════════

interface FlwInitiatePaymentResponse {
  status: string;
  message: string;
  data?: {
    link: string;
  };
}

/**
 * Start a payment. Returns a hosted Flutterwave checkout URL.
 * The caller (checkout API) should already have:
 *   - Inserted a pending row in `transactions` with this txRef
 *   - Validated the user is authenticated
 */
export async function initiatePayment(
  params: InitiatePaymentParams
): Promise<InitiatePaymentResult> {
  const { userId, email, fullName, tier, currency, billing, txRef, redirectUrl } = params;
  const pricing = getPricing(tier, currency);

  // Body shape per Flutterwave Standard checkout docs
  const body: Record<string, unknown> = {
    tx_ref: txRef,
    amount: pricing.amount,
    currency,
    redirect_url: redirectUrl,
    customer: {
      email,
      name: fullName,
    },
    customizations: {
      title: 'Riftvid',
      description: `${pricing.label} ${billing === 'monthly' ? 'subscription' : '— 30 day access'}`,
      logo: 'https://riftvid.vercel.app/icon.png', // optional, ignored if missing
    },
    // META is critical — Flutterwave includes this in the webhook so we know
    // which user / tier this payment belongs to without an extra DB lookup.
    meta: {
      user_id: userId,
      tier,
      billing,
      credits: pricing.credits,
    },
  };

  if (billing === 'monthly') {
    // Recurring — attach payment plan ID. Flutterwave will auto-charge monthly.
    body.payment_plan = await getOrCreatePaymentPlan(tier, currency, 'monthly');
  }

  const res = await fetch(`${FLW_API_BASE}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as FlwInitiatePaymentResponse;
  if (!res.ok || json.status !== 'success' || !json.data?.link) {
    throw new Error(
      `Flutterwave initiate payment failed: ${json.message || `HTTP ${res.status}`}`
    );
  }

  return { paymentLink: json.data.link };
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTION VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════
//
// Defense in depth: when the webhook fires, we don't trust its payload
// blindly. We call Flutterwave's verify endpoint to confirm the payment
// is REALLY successful before granting tier upgrades or credits.
//
// This protects against:
//  - Webhook spoofing (a determined attacker who guesses the secret hash)
//  - Replay attacks (re-sending an old webhook payload)
//  - Bugs in our hash verification

interface FlwVerifyResponse {
  status: string;
  message: string;
  data?: {
    id: number;
    tx_ref: string;
    status: string; // 'successful' | 'failed' | ...
    amount: number;
    currency: string;
    customer?: { email?: string };
  };
}

/**
 * Verify a transaction by ID with Flutterwave directly.
 * `txId` is the Flutterwave-side ID (numeric), NOT our tx_ref.
 */
export async function verifyTransaction(txId: number | string): Promise<VerifyTransactionResult> {
  const res = await fetch(`${FLW_API_BASE}/transactions/${txId}/verify`, {
    headers: { Authorization: `Bearer ${getSecretKey()}` },
  });
  const json = (await res.json()) as FlwVerifyResponse;

  if (!res.ok || json.status !== 'success' || !json.data) {
    return {
      verified: false,
      flwTxId: null,
      amount: 0,
      currency: 'USD',
      customerEmail: null,
      status: json.message || `HTTP ${res.status}`,
      rawResponse: json,
    };
  }

  return {
    verified: json.data.status === 'successful',
    flwTxId: json.data.id,
    amount: json.data.amount,
    currency: (json.data.currency as Currency) || 'USD',
    customerEmail: json.data.customer?.email || null,
    status: json.data.status,
    rawResponse: json,
  };
}

/**
 * Build our internal transaction reference (`tx_ref`).
 * Format: riftvid_{userIdSuffix}_{timestamp}_{random}
 * Stable enough to debug from logs, unique enough to never collide.
 */
export function buildTxRef(userId: string): string {
  const userSuffix = userId.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  const ts = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `riftvid_${userSuffix}_${ts}_${random}`;
}
