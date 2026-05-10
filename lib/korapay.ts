/**
 * Korapay API client for Riftvid
 * 
 * Handles initializing payment charges and verifying transactions.
 * Server-side only — uses secret key, never expose to browser.
 */

const KORAPAY_BASE_URL = 'https://api.korapay.com/merchant/api/v1';

export interface InitializeChargeRequest {
  amount: number; // in major unit (Naira, not kobo)
  currency: 'NGN' | 'USD';
  reference: string; // unique transaction ID
  customer: {
    name: string;
    email: string;
  };
  notification_url?: string; // webhook URL
  redirect_url: string; // where to send user after payment
  narration?: string; // description shown on receipt
  metadata?: Record<string, unknown>; // we'll pass userId, packId here
}

export interface InitializeChargeResponse {
  status: boolean;
  message: string;
  data: {
    reference: string;
    checkout_url: string;
    amount: number;
    currency: string;
  };
}

export interface VerifyTransactionResponse {
  status: boolean;
  message: string;
  data: {
    reference: string;
    status: 'success' | 'failed' | 'processing' | 'expired';
    amount: number;
    currency: string;
    fee?: number;
    customer?: {
      name: string;
      email: string;
    };
    metadata?: Record<string, unknown>;
    paid_at?: string;
  };
}

/**
 * Initialize a charge — returns a checkout URL the user should be redirected to
 */
export async function initializeCharge(
  request: InitializeChargeRequest
): Promise<InitializeChargeResponse> {
  const secretKey = process.env.KORAPAY_SECRET_KEY;
  if (!secretKey) {
    throw new Error('KORAPAY_SECRET_KEY not configured');
  }

  const res = await fetch(`${KORAPAY_BASE_URL}/charges/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const data = await res.json();

  if (!res.ok || !data.status) {
    throw new Error(data.message || `Korapay initialize failed: ${res.status}`);
  }

  return data as InitializeChargeResponse;
}

/**
 * Verify a transaction by reference — used after redirect back from Korapay
 */
export async function verifyTransaction(reference: string): Promise<VerifyTransactionResponse> {
  const secretKey = process.env.KORAPAY_SECRET_KEY;
  if (!secretKey) {
    throw new Error('KORAPAY_SECRET_KEY not configured');
  }

  const res = await fetch(`${KORAPAY_BASE_URL}/charges/${reference}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  const data = await res.json();

  if (!res.ok || !data.status) {
    throw new Error(data.message || `Korapay verify failed: ${res.status}`);
  }

  return data as VerifyTransactionResponse;
}

/**
 * Generate a unique reference for a transaction
 */
export function generateReference(prefix = 'riftvid'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${random}`;
}
