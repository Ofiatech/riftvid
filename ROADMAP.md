# Riftvid Roadmap 🎬

> Founder: Nweze Michael (Ofiatech) 🇳🇬
> Last updated: May 2026
> Status: Pre-launch · Stealth-build mode
> Live URL: https://riftvid.vercel.app

---

## North Star

**Make Riftvid the AI video platform built for African creators that anyone in the world can use.**

Voice/accent diversity, Nigerian Gen Z aesthetics, scene-based storytelling — these aren't features, they're identity.

**Long-term positioning:** Final Cut Pro for AI-generated narrative content, with character consistency built in from script.

---

## Phase 1 — Core MVP ✅ SHIPPED

**Goal:** Generate ONE 10-second video from image + prompt, polished end-to-end.

- [x] Premium dashboard UI (Apple × HeyGen aesthetic)
- [x] Clerk authentication (Google + Email)
- [x] Vercel deployment + auth-protected routes
- [x] Mobile-responsive HeyGen-style sidebar
- [x] Rift Assistant with vision (sees uploaded images)
- [x] Dynamic chat flow with custom answer fallback
- [x] File picker with thumbnail preview
- [x] OpenAI integration for prompt refinement
- [x] Real video generation API (Grok Imagine via Fal.ai)
- [x] Render progress UI + job status polling
- [x] User video library with Supabase persistence
- [x] Apple-grade animations + UX polish
- [x] Native audio enabled (Grok Imagine — Phase 4 audio delivered EARLY)
- [x] Auto aspect ratio matching (videos match source dimensions)
- [x] Rift Assistant v3 with anti-glitch + audio safeguards
- [x] Rift Feedback Logger (data collection for v4 improvements)

---

## Phase 2 — Library, Storage, Polish ✅ SHIPPED

- [x] Real video library replacing mock data
- [x] Supabase tables (videos, profiles, transactions)
- [x] Supabase storage for generated MP4s
- [x] Apple-style animations across modals
- [x] Search, filter, delete in library
- [x] Real-time status updates for in-progress generations

---

## Phase 3 — Monetization Foundation 🚧 IN PROGRESS

**Goal:** People can pay. Riftvid earns revenue from day one of launch.

### Stage 1: Credits System ✅ SHIPPED
- [x] Credits balance tracking per user
- [x] 5 free credits on signup
- [x] Credit deduction on generation
- [x] Automatic refunds on failed generations
- [x] Transaction log
- [x] Out-of-credits state with upgrade prompt

### Stage 2: Korapay Payments 🚧 IN PROGRESS
**Note:** Switched from Stripe → Korapay for Nigerian-friendly USD + NGN support.

- [x] Korapay backend infrastructure installed (5 files)
- [x] Pricing tiers configured in code
- [x] Checkout API endpoints
- [x] Verification page
- [ ] Korapay KYC verification (pending — waiting on Korapay)
- [ ] Buy Credits modal (frontend — waiting for keys)
- [ ] Webhook handler with HMAC verification
- [ ] Sidebar buttons wired ("Get more credits", "Upgrade plan")

### Pricing Tiers (Final)

| Tier | Price | Credits | Notes |
|------|-------|---------|-------|
| 🆓 Free | $0 | 5 one-time | New user trial |
| 🎬 Creator | $9.99/mo | 50 | Audio enabled, basic features |
| 🚀 Pro | $29.99/mo | 200 | Premium models access |
| 🎥 Studio | $99/mo | 800 | Episode mode + character consistency (Phase 5+) |
| 🏆 Studio Pro | $299/mo | Unlimited | Long episodes + agencies (Phase 6+) |

### Credit Packs (Top-ups)
| Pack | USD | NGN | Credits |
|------|-----|-----|---------|
| Starter | $4.99 | ₦7,000 | 25 |
| Creator | $9.99 | ₦14,000 | 75 |
| Pro | $24.99 | ₦35,000 | 250 |

---

## Phase 4 — Audio Integration ✅ SHIPPED EARLY

**Originally planned for later. Delivered via Grok Imagine swap.**

- [x] Native audio + lip-sync (Grok Imagine)
- [x] Ambient sounds + dialogue
- [x] Character voice in clips
- [x] African accent handling (Grok trained on diverse data)

---

## Phase 5 — Sequencer 🎬 (THE MOAT)

**Codename:** Working title — "Rift Sequence" or "StoryRift" (TBD)

**The big idea:** Most AI models cap at 10 seconds per video. Riftvid lets creators generate FULL stories by chaining scenes together.

### Sequencer v1 — LOCKED PLAN (Path C, May 2026)

**Architecture: 3-Level Hierarchy** (matches Hollywood production structure)