/**
 * Riftvid pricing configuration
 * 
 * Single source of truth for all credit packs and pricing.
 * To add new packs or adjust prices, edit this file only.
 */

export type Currency = 'NGN' | 'USD';

export interface CreditPack {
  id: string;
  name: string;
  description: string;
  credits: number;
  price_usd_cents: number; // store in cents to avoid floating point
  price_ngn_kobo: number; // NGN in kobo (1 NGN = 100 kobo)
  highlighted?: boolean; // most popular pack
  badge?: string; // e.g. "Best Value"
}

// FX rate: 1 USD = 1,400 NGN (slightly above official ~1,355 to cover fees)
export const NGN_PER_USD = 1400;

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: 'pack_small',
    name: 'Starter',
    description: 'Perfect for trying things out',
    credits: 25,
    price_usd_cents: 499, // $4.99
    price_ngn_kobo: 700_000, // ₦7,000
  },
  {
    id: 'pack_medium',
    name: 'Creator',
    description: 'Most popular for regular use',
    credits: 75,
    price_usd_cents: 999, // $9.99
    price_ngn_kobo: 1_400_000, // ₦14,000
    highlighted: true,
    badge: 'Most Popular',
  },
  {
    id: 'pack_large',
    name: 'Pro',
    description: 'Best value for power users',
    credits: 250,
    price_usd_cents: 2499, // $24.99
    price_ngn_kobo: 3_500_000, // ₦35,000
    badge: 'Best Value',
  },
];

/**
 * Format price for display
 */
export function formatPrice(pack: CreditPack, currency: Currency): string {
  if (currency === 'NGN') {
    const naira = pack.price_ngn_kobo / 100;
    return `₦${naira.toLocaleString('en-NG')}`;
  }
  const dollars = pack.price_usd_cents / 100;
  return `$${dollars.toFixed(2)}`;
}

/**
 * Get amount in smallest unit (kobo for NGN, cents for USD) — what Korapay expects
 */
export function getPriceInSmallestUnit(pack: CreditPack, currency: Currency): number {
  return currency === 'NGN' ? pack.price_ngn_kobo : pack.price_usd_cents;
}

/**
 * Korapay expects amounts in major units (Naira not kobo, dollars not cents)
 * for currency=NGN, divide kobo by 100; for USD, divide cents by 100
 */
export function getPriceForKorapay(pack: CreditPack, currency: Currency): number {
  return currency === 'NGN' ? pack.price_ngn_kobo / 100 : pack.price_usd_cents / 100;
}

/**
 * Detect user's preferred currency based on country
 * Currently: NGN for Nigeria, USD for everyone else
 */
export function getCurrencyForCountry(countryCode: string | null): Currency {
  if (countryCode === 'NG') return 'NGN';
  return 'USD';
}

/**
 * Find pack by ID — used in checkout flow to verify pack is real
 */
export function getPackById(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

/**
 * Calculate cost per credit (for marketing copy)
 */
export function getCostPerCredit(pack: CreditPack, currency: Currency): string {
  if (currency === 'NGN') {
    const perCredit = pack.price_ngn_kobo / 100 / pack.credits;
    return `₦${Math.round(perCredit).toLocaleString('en-NG')}`;
  }
  const perCredit = pack.price_usd_cents / 100 / pack.credits;
  return `$${perCredit.toFixed(2)}`;
}
