// app/api/utils/resolve-image-url/route.ts
//
// POST /api/utils/resolve-image-url
//
// Body: { url: string }
//
// Behavior:
//   1. Validate URL is http(s)
//   2. HEAD-request the URL to see what content-type it serves
//   3. If image → return the URL directly
//   4. If HTML → GET the page, parse <meta property="og:image">,
//      <meta name="twitter:image">, or first <img src=...> as fallback
//   5. Verify the resolved image URL actually loads
//   6. Return the final image URL the frontend can use as source_image_url
//
// Why: Users will paste gallery page URLs (Pexels, Unsplash, Pinterest, etc.)
// expecting "it just works." Client-side new Image() rejects those because
// they serve HTML, not image bytes. This proxy resolves them transparently.
//
// Limits:
//   - Instagram, login-walled sites, bot-protected (Cloudflare challenge): can't bypass
//   - We return clear error messages so user knows to try a different URL

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB cap on page download
const FETCH_TIMEOUT_MS = 15000;        // 15s timeout per request

// Browser-like UA — some sites (Pexels, etc.) reject default fetch UA
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Image MIME prefixes we accept as "this is an image"
const IMAGE_MIME_PREFIXES = ['image/'];

// Common image file extensions, used when content-type is missing or ambiguous
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'];

// ============================================================================
// TYPES
// ============================================================================

interface ResolveBody {
  url: string;
}

interface ResolveSuccess {
  imageUrl: string;
  source: 'direct' | 'og_image' | 'twitter_image' | 'first_img_tag';
  originalUrl: string;
}

interface ResolveError {
  error: string;
  message: string;
  hint?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function isHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(';')[0].trim();
  return IMAGE_MIME_PREFIXES.some((p) => ct.startsWith(p));
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(';')[0].trim();
  return ct === 'text/html' || ct === 'application/xhtml+xml';
}

function hasImageExtension(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return IMAGE_EXTS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Resolve a relative or protocol-relative URL against a base URL.
 * Returns null if resolution fails.
 */
function resolveAgainstBase(maybeRelativeUrl: string, baseUrl: string): string | null {
  try {
    return new URL(maybeRelativeUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Fetch with timeout. Uses AbortController so the fetch is cancelled
 * cleanly if we hit the deadline.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the most likely "hero image" URL from an HTML page.
 *
 * Priority:
 *   1. <meta property="og:image" content="...">      (most reliable, what FB/Twitter/LinkedIn use)
 *   2. <meta name="twitter:image" content="...">      (also reliable)
 *   3. <meta property="og:image:url" content="...">   (alt form)
 *   4. First <img src="..."> with a non-tiny apparent size  (last resort)
 *
 * Uses regex parsing instead of a full HTML parser because:
 *   - No dependency needed (works in Vercel edge/serverless)
 *   - We only need 4 specific tags, not a full DOM
 *   - Fast and predictable
 *
 * Returns the URL (potentially relative — caller must resolve against base)
 * or null if nothing found.
 */
function extractImageFromHtml(
  html: string
): { url: string; source: 'og_image' | 'twitter_image' | 'first_img_tag' } | null {
  // Strip <script> blocks before searching — scripts contain code that looks
  // like meta tags and confuses naive regex
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  // 1. og:image — match both <meta property="og:image" content="..."> AND reverse attribute order
  const ogMatch =
    stripped.match(
      /<meta\s+[^>]*property\s*=\s*["']og:image(?::url)?["'][^>]*content\s*=\s*["']([^"']+)["']/i
    ) ||
    stripped.match(
      /<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image(?::url)?["']/i
    );
  if (ogMatch?.[1]) {
    return { url: ogMatch[1].trim(), source: 'og_image' };
  }

  // 2. twitter:image — same dual attribute order
  const twitterMatch =
    stripped.match(
      /<meta\s+[^>]*name\s*=\s*["']twitter:image["'][^>]*content\s*=\s*["']([^"']+)["']/i
    ) ||
    stripped.match(
      /<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']twitter:image["']/i
    );
  if (twitterMatch?.[1]) {
    return { url: twitterMatch[1].trim(), source: 'twitter_image' };
  }

  // 3. First <img> tag (last resort, low confidence)
  // Look for any <img src="..."> — we only take the first one
  const imgMatch = stripped.match(/<img\s+[^>]*src\s*=\s*["']([^"']+)["']/i);
  if (imgMatch?.[1]) {
    return { url: imgMatch[1].trim(), source: 'first_img_tag' };
  }

  return null;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    // --- Auth: require logged-in user (this is a real cost — they could spam) ---
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json<ResolveError>(
        { error: 'unauthorized', message: 'Sign in to use this feature.' },
        { status: 401 }
      );
    }

    // --- Parse input ---
    let body: ResolveBody;
    try {
      body = (await req.json()) as ResolveBody;
    } catch {
      return NextResponse.json<ResolveError>(
        { error: 'invalid_json', message: 'Invalid request body.' },
        { status: 400 }
      );
    }

    const url = (body.url ?? '').trim();
    if (!url) {
      return NextResponse.json<ResolveError>(
        { error: 'missing_url', message: 'Please provide a URL.' },
        { status: 400 }
      );
    }
    if (!isHttpUrl(url)) {
      return NextResponse.json<ResolveError>(
        {
          error: 'invalid_url',
          message: 'URL must start with https:// or http://',
        },
        { status: 400 }
      );
    }

    // --- FAST PATH: if URL looks like a direct image by extension, just verify and return ---
    if (hasImageExtension(url)) {
      try {
        const headRes = await fetchWithTimeout(
          url,
          { method: 'HEAD', headers: { 'User-Agent': BROWSER_UA } },
          FETCH_TIMEOUT_MS
        );
        if (headRes.ok && isImageContentType(headRes.headers.get('content-type'))) {
          return NextResponse.json<ResolveSuccess>({
            imageUrl: url,
            source: 'direct',
            originalUrl: url,
          });
        }
        // HEAD failed or returned non-image — fall through to full resolution
      } catch {
        // HEAD threw (some servers reject HEAD) — fall through
      }
    }

    // --- GENERAL PATH: GET the URL and figure out what it is ---
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': BROWSER_UA,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
        },
        FETCH_TIMEOUT_MS
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      if (msg.includes('aborted') || msg.toLowerCase().includes('timeout')) {
        return NextResponse.json<ResolveError>(
          {
            error: 'timeout',
            message: 'That site took too long to respond.',
            hint: 'Try a different image source.',
          },
          { status: 504 }
        );
      }
      return NextResponse.json<ResolveError>(
        {
          error: 'fetch_failed',
          message: "Couldn't reach that URL.",
          hint: 'Check the link and try again.',
        },
        { status: 502 }
      );
    }

    if (!res.ok) {
      // 401/403 → login wall or bot block. 404 → not found. etc.
      const status = res.status;
      let hint: string | undefined;
      if (status === 401 || status === 403) {
        hint =
          "That site is private or blocks our request. Try right-clicking the image and choosing 'Copy image address' to get a direct link.";
      } else if (status === 404) {
        hint = 'The link might be expired or mistyped.';
      } else if (status >= 500) {
        hint = "The site is having problems. Try again later or use a different source.";
      }
      return NextResponse.json<ResolveError>(
        {
          error: 'http_error',
          message: `That URL returned an error (HTTP ${status}).`,
          hint,
        },
        { status: 502 }
      );
    }

    const contentType = res.headers.get('content-type');

    // --- Case 1: URL IS an image — return it directly ---
    if (isImageContentType(contentType)) {
      return NextResponse.json<ResolveSuccess>({
        imageUrl: url,
        source: 'direct',
        originalUrl: url,
      });
    }

    // --- Case 2: URL is an HTML page — parse for og:image ---
    if (isHtmlContentType(contentType)) {
      // Read response with size cap to avoid runaway pages
      const reader = res.body?.getReader();
      if (!reader) {
        return NextResponse.json<ResolveError>(
          { error: 'empty_response', message: 'That page returned nothing.' },
          { status: 502 }
        );
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > MAX_HTML_SIZE) {
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            return NextResponse.json<ResolveError>(
              {
                error: 'page_too_large',
                message: 'That page is too large to scan.',
                hint: 'Try a direct image URL instead.',
              },
              { status: 413 }
            );
          }
          chunks.push(value);
        }
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const html = buf.toString('utf-8');

      const extracted = extractImageFromHtml(html);
      if (!extracted) {
        return NextResponse.json<ResolveError>(
          {
            error: 'no_image_found',
            message: "We couldn't find an image on that page.",
            hint:
              "Right-click the image you want, choose 'Copy image address', and paste that link instead.",
          },
          { status: 422 }
        );
      }

      // Resolve relative URLs against the base page URL
      const finalImageUrl =
        extracted.url.startsWith('http://') || extracted.url.startsWith('https://')
          ? extracted.url
          : resolveAgainstBase(extracted.url, url);

      if (!finalImageUrl) {
        return NextResponse.json<ResolveError>(
          {
            error: 'invalid_image_url',
            message: "Found an image reference but couldn't form a valid URL.",
            hint: 'Try a direct image link instead.',
          },
          { status: 422 }
        );
      }

      // Verify the resolved image actually loads
      try {
        const verifyRes = await fetchWithTimeout(
          finalImageUrl,
          { method: 'HEAD', headers: { 'User-Agent': BROWSER_UA } },
          FETCH_TIMEOUT_MS
        );
        if (!verifyRes.ok || !isImageContentType(verifyRes.headers.get('content-type'))) {
          // HEAD might fail on some servers — try GET as fallback for verify
          const verifyGet = await fetchWithTimeout(
            finalImageUrl,
            { method: 'GET', headers: { 'User-Agent': BROWSER_UA } },
            FETCH_TIMEOUT_MS
          );
          if (!verifyGet.ok || !isImageContentType(verifyGet.headers.get('content-type'))) {
            return NextResponse.json<ResolveError>(
              {
                error: 'image_unreachable',
                message: "Found an image link but couldn't load it.",
                hint: 'Try a direct image URL instead.',
              },
              { status: 422 }
            );
          }
          // Cancel the body — we just needed to verify the headers
          try {
            await verifyGet.body?.cancel();
          } catch {
            /* ignore */
          }
        }
      } catch {
        // Verify failed — return the URL anyway and let the frontend try to load it.
        // Some image CDNs reject our server's IP but allow browsers.
      }

      return NextResponse.json<ResolveSuccess>({
        imageUrl: finalImageUrl,
        source: extracted.source,
        originalUrl: url,
      });
    }

    // --- Case 3: URL is neither image nor HTML (PDF, video, etc.) ---
    return NextResponse.json<ResolveError>(
      {
        error: 'unsupported_content',
        message: `That URL is a ${contentType || 'non-image, non-HTML file'}.`,
        hint: 'We need a direct image link or a page containing an image.',
      },
      { status: 415 }
    );
  } catch (err) {
    console.error('/api/utils/resolve-image-url error:', err);
    return NextResponse.json<ResolveError>(
      {
        error: 'internal_error',
        message: 'Something went wrong on our side.',
        hint: 'Try again, or paste a different URL.',
      },
      { status: 500 }
    );
  }
}