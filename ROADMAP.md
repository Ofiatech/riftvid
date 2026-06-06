# Riftvid Roadmap 🎬

> Founder: Nweze Michael (Ofiatech) 🇳🇬
> Last updated: June 6, 2026
> Status: Pre-launch · Final polish before external eyes
> Live URL: <https://riftvid.vercel.app>

-----

## 🛡️ THE DISCIPLINE CONTRACT

**This roadmap is the single source of truth.** It’s what gets built, in what order, with what scope.

### Rules I (Claude) will enforce:

1. **No drift without acknowledgment.** If the founder proposes something not on this roadmap, I will STOP and ask:
- (a) Park as a future idea?
- (b) Swap with something currently planned?
- (c) Insist on a full planning session to add it?
  No code is written until the founder answers.
1. **A “full planning session” means** — we discuss scope, dependencies, timing, what it bumps off the list, and the founder saves a ROADMAP update before any code happens.
1. **The founder can ALWAYS insist.** It’s the founder’s product. But I will explicitly call out the drift cost: “This delays launch by X sessions, bumps Y feature back to Phase Z.” Override knowingly, not accidentally.
1. **Strategic conversations are OK anytime.** Discussion isn’t drift. Drift is committing to BUILD something not on the roadmap.
1. **Every session should end with a roadmap status check.** What got done? What’s next? Any drift to log? Updates saved?
1. **Adding scope = removing scope.** No infinite list growth. If something gets added to Phase 4, something else must move out of Phase 4. Time budgets are finite.

### Rules the founder agrees to:

1. **No mid-session pivots without `[full planning session]` flag.** If something feels urgent and new, say “I want a full planning session on X” — we pause work, plan, update roadmap, then continue.
1. **Trust the order.** If we said Avatars comes before Voices, don’t slip into “let me just quickly add a voice feature first.” That’s drift.
1. **Big ideas get parked, not built.** Big ideas (Production Studio is a perfect example) belong in Future Phases, NOT in active work.

-----

## North Star

**Riftvid is the conversational AI creative platform for narrative video — globally.**

You don’t edit timelines. You direct an AI creative partner that turns your story into a movie, or your brief into an ad. Story-to-Scenes AI Director (Rift Studio) for narrative content. Production Studio for ad campaigns and explainer videos.

**What makes Riftvid different from Sora / Runway / HeyGen / Pika:**

- **Narrative orchestration**, not just clip generation — scenes, characters, continuity, story arcs
- **Conversational interface**, not timeline editors — talk to Rift, it builds the video
- **Character consistency** across an entire production, not single clips
- **Accent and language diversity** — works as well for Nigerian Pidgin as for Japanese as for Brazilian Portuguese as for American English

**Positioning rule:** Riftvid is a global product that happens to serve African markets exceptionally well — NOT a regional product trying to go global. Accent diversity, NGN payments, Nigerian Pidgin support are SUPERPOWERS, not the marketing pitch. The marketing pitch is “Direct your AI movie.”

**Reference points:** Think Spotify or Notion — global products with deep regional excellence — NOT Boomplay or Iroko TV which capped themselves with regional positioning.

-----

## ✅ ALREADY SHIPPED (Phases 1–3)

### Phase 1 — Core MVP

- Premium dashboard UI (Apple × HeyGen aesthetic)
- Clerk authentication (Google + Email)
- Vercel deployment + auth-protected routes
- Mobile-responsive sidebar
- Rift Assistant v3 with vision (image understanding + scene-specific questions)
- Anti-glitch + audio safeguards in prompt synthesis
- Real video generation (Grok Imagine via Fal.ai) with native audio + lip-sync
- Render progress UI + status polling
- Auto aspect ratio matching
- Rift Feedback Logger for v4 improvement data

### Phase 2 — Library, Storage, Polish

- Real video library (Supabase persistence)
- Storage for generated MP4s
- Apple-style modal animations
- Search, filter, delete in library
- Real-time generation status updates

### Phase 3 — Monetization (Flutterwave)

- Credits system (balance, deduction, automatic refunds on failure)
- 5 free credits on signup
- Out-of-credits state with upgrade prompt
- **Flutterwave payments LIVE** (replaced Korapay)
  - KYC verified, live mode active
  - USD + NGN dual currency with geo auto-detection
  - Both subscription (monthly auto-renew) and one-time (30-day) billing
  - 6-layer webhook security
  - Renewal path with subscription_customer_id lookup
  - Credits roll over forever (never expire — trust signal/moat)
- TierPickerModal with sidebar wiring across all pages
- ‘team’ → ‘studio’ tier naming standardization

### Phase 3.5 — Sequencer v1 (Manual Builder) + Export

- 3-level hierarchy: Projects → Scenes → Clips
- Scene-first manual builder
- Last-frame chaining between clips (continuity)
- Cinematic Studio Editor v3 (Premiere Pro-style desktop, CapCut-style mobile)
- Server-side merge via Cloudinary
- Export feature (ExportSheet drawer with Web Share API)
- Tier-gated export (Free can’t export, Creator+ can)

-----

## 🎯 PRICING TIERS (Canonical)

|Tier     |USD      |NGN     |Credits/refill|Export|Audio|Notes                                  |
|---------|---------|--------|--------------|------|-----|---------------------------------------|
|🆓 Free   |$0       |₦0      |5 (one-time)  |❌     |❌    |Signup trial                           |
|🎬 Creator|$9.99/mo |₦14,000 |50/mo         |✅     |✅    |Entry tier                             |
|🚀 Pro    |$29.99/mo|₦42,000 |200/mo        |✅     |✅    |+ Premium models, AI Director (Phase 5)|
|🎥 Studio |$99/mo   |₦140,000|800/mo        |✅     |✅    |+ Episode mode (Phase 5+)              |

**Credit costs:** 5s clip = 1 credit, 10s clip = 2 credits. Tier subscription extends 30 days from purchase or last renewal. Unused credits roll over forever.

**Credit packs (Phase 4.5+):** Top-up packs deferred — Korapay legacy code preserved for revival when needed.

-----

## 🚀 PHASE 4 — LAUNCH PREP (CURRENT)

**Goal:** Every visible UI element does something real OR is intentionally hidden. No half-working features visible to external users.

**Launch criteria:** Founder is comfortable showing Riftvid to anyone, anywhere, and not having to apologize for broken/incomplete features.

### 🎬 PRE-LAUNCH PUNCH LIST (in build order)

#### 4.1 — Today’s session (already in progress)

- [x] Flutterwave payments live (Phase 3 complete)
- [x] Sidebar Upgrade button wired to TierPickerModal (all pages)
- [x] ‘team’ → ‘studio’ tier naming fixed in Sidebar
- [x] Decision: PhotoRoom Product Animator replaces Digital Twin permanently
- [ ] **ROADMAP.md updated** ← we are here
- [ ] **Dashboard hero reshuffle:**
  - Demote “Create Cinematic Magic” → wire as the **Image to Motion** tool card below
  - Promote **Rift Studio** to Hero 1 (NO video animations today — keep basic UI style matching current; cinematic backgrounds polished later in 4.9)
  - Add **Production Studio Hero 2** — basic UI matching Rift Studio hero style, HIDDEN behind `SHOW_PRODUCTION_STUDIO=false` feature flag
  - Replace Digital Twin tool card with **Product Animator** placeholder (tile only, full build comes in 4.7)
- [ ] **Wire Image to Motion tool card** → opens existing “Create Cinematic Magic” generation modal
- [ ] **Back button bug** — investigate (likely small fix, may be Next.js routing config)

#### 4.2 — Rift Studio polish + finish manual builder

- [ ] Stress test Sequencer v1 with real production flows
- [ ] UX polish on scene editor, clip editing
- [ ] Fix any bugs discovered by founder dogfooding
- [ ] Confirm merge/export flow works end-to-end at scale (5+ scenes, 10+ clips)

#### 4.3 — Avatars (THE BIG ONE)

- [ ] Schema: `avatars` table (user_id, name, photo_url, voice_id, description, attributes JSON)
- [ ] Avatars library page (sidebar navigation)
- [ ] Create new avatar flow (upload photo, set name, write character description)
- [ ] Avatar picker integrated into clip generation (Rift Studio + clip creation modal)
- [ ] Character consistency hooks in prompt synthesis (rift-assistant route)
- [ ] Display avatar thumbnails across the app where characters appear

#### 4.4 — Voices (ElevenLabs integration)

- [ ] Schema: `voices` table (user_id, name, voice_id, source: ‘preset’ | ‘cloned’)
- [ ] ElevenLabs API integration (server route, key management)
- [ ] Voice library page (sidebar navigation)
- [ ] Voice browser with previews
- [ ] Voice cloning UI (upload sample → train → use)
- [ ] Per-avatar voice assignment
- [ ] Voice selection in clip generation (when dialogue is present)

#### 4.5 — Brand Kit

- [ ] Schema: `brand_kits` table (user_id, logo_url, colors, fonts, tagline)
- [ ] Brand Kit page (sidebar navigation)
- [ ] Upload logo + asset management
- [ ] Color palette picker
- [ ] (Brand Kit will get heavy use in Phase 6 Production Studio; v1 is just storage)

#### 4.6 — Analytics

- [ ] Schema: events table or aggregation views (videos generated, credits used over time, time spent, etc.)
- [ ] Analytics page (sidebar navigation)
- [ ] Charts: generations over time, credits used, tier history
- [ ] Tier expiration countdown (when Studio subscription renews)

#### 4.7 — Product Animator (PhotoRoom integration)

- [ ] PhotoRoom API integration (`/v1/animate` endpoint, May 2026)
- [ ] Product Animator tool flow (upload product image, pick template, generate)
- [ ] Wire to the tool card on dashboard (replaces former Digital Twin slot)
- [ ] Cost model: PhotoRoom Plus plan ($0.10/image, $100/mo entry) — bake into credit cost (1-2 credits per product animation)
- [ ] Result saved to library alongside regular videos

#### 4.8 — Other tool cards

- [ ] **Generate from Prompt** — text-to-video (Grok Imagine without image input). Simple wrapper.
- [ ] **Translate Video** — research best provider (HeyGen API at $0.05/sec, or other). Build or hide.
  - **Decision pending:** if this turns out to require enterprise-only API or is too expensive, HIDE the card for launch
- [ ] Help center (basic FAQ, contact form, link to docs)
- [ ] Notifications bell (real notification feed from Supabase events)

#### 4.9 — Dashboard polish (last)

- [ ] Cinematic video backgrounds for Rift Studio hero card
  - Decision pending: dogfood via Grok Imagine, or use Pexels stock, or use Runway/Sora/Veo for AI stock
- [ ] Final animation polish across the app
- [ ] Delete `app/test-merge/page.tsx` (dev artifact)
- [ ] Clean up any `'team'` → `'studio'` references in other files (lib/credits.ts already done, app/projects/[id]/page.tsx tier display, ProjectCard, etc.)
- [ ] Cleanup middleware.ts Clerk type errors (pre-existing, non-blocking)

#### 4.10 — Brand polish + auth professionalism

- [ ] **Browser tab title** — change from “Riftvid - AI Video Studio” to just **“Riftvid”** in `app/layout.tsx` (em-dash with tagline screams generic AI startup; premium products like Notion, Linear, Cursor just use the brand name)
- [ ] **Switch Clerk to Production mode**
  - Clerk dashboard → upgrade app from Development to Production
  - Get production API keys (separate from dev keys)
  - Update `.env.local` AND Vercel env vars with production Clerk keys
  - Configure production domain in Clerk (riftvid.vercel.app, eventually custom domain)
  - Reconfigure OAuth providers (Google) for production domain
  - Removes the “Development mode” banner that currently appears
- [ ] **Embedded sign-in flow** — verify `/sign-in` and `/sign-up` use Clerk’s embedded `<SignIn />` and `<SignUp />` components, NOT redirect-mode
  - Goal: no visible flash to `clerk.accounts.dev` in the URL bar
  - User experience: form lives entirely on Riftvid pages
  - OAuth handshake (Google sign-in) is unavoidable but happens fast and is industry-standard
- [ ] (Optional, post-launch) Custom Clerk auth subdomain (e.g. `auth.riftvid.com`) — requires Clerk paid feature, defer until proven need

#### 4.11 — Homepage + Legal pages

**The front door doesn’t exist yet.** Currently `/` routes to authenticated dashboard, unauthenticated users get punted to Clerk sign-in immediately. That’s a terrible first impression.

- [ ] **Homepage at `/` (when unauthenticated)**
  - Authenticated users still see the dashboard at `/`
  - Unauthenticated users see the marketing homepage
  - Route: middleware-based or Next.js conditional rendering
- [ ] **Homepage sections** (responsive, mobile-critical):
  - Hero: tagline (“Direct your AI movie” or similar — global positioning, NOT African-first), sub-tagline, demo video/animated preview, “Get started free” CTA
  - Features section: 4-6 key capabilities with visuals (Rift Studio, Product Animator, Translate, Audio, Character Consistency, Multi-language)
  - “How it works” — 3-4 step explanation of the conversational flow
  - Pricing section (mirrors TierPickerModal info, USD + NGN toggle)
  - FAQ section (10-15 common questions)
  - Footer: links, social, legal, contact
- [ ] **SEO basics**: meta tags, Open Graph image, structured data, sitemap.xml, robots.txt
- [ ] **Legal pages** (REQUIRED for Clerk production + Flutterwave compliance + general professionalism):
  - `/terms` — Terms of Service
  - `/privacy` — Privacy Policy
  - `/cookies` — Cookie Policy (if applicable)
  - `/refunds` — Refund Policy (Flutterwave + tier subscriptions)
  - Decision: use a generator (e.g. Termly, iubenda) for v1, custom drafts later
- [ ] Demo video for hero — sourced from real Riftvid output (dogfood) or from production team
- [ ] Headshot/testimonial section — empty for v1 (no users yet), placeholder structure for later

#### 4.12 — Final launch checks

- [ ] Real card payment test with founder’s Flutterwave card (when it arrives)
- [ ] Full end-to-end smoke test: signup → free credits → generate → pay → upgrade → renew → cancel → re-pay
- [ ] Mobile QA on iPhone 15 Pro Max (founder’s device)
- [ ] Custom domain (riftvid.ai or similar) — Vercel migration + update NEXT_PUBLIC_APP_URL + update Flutterwave webhook URL + update Clerk production domain
- [ ] Lighthouse audit on homepage (target 90+ across all metrics)
- [ ] Cross-browser test (Safari, Chrome, Firefox, Edge — desktop + mobile)
- [ ] Public launch 🚀

-----

## 🎬 PHASE 5 — STORY-TO-SCENES AI DIRECTOR

**Goal:** User pastes a story → Rift Studio breaks it into scenes → clips → prompts → character list. The AI is the director.

**Marketing tagline:** “Type your story. Get your movie.”

**This is the moat we’ve been climbing toward.** Current Sequencer v1 manual builder is the SCAFFOLDING. AI Director is the actual product.

**Tier gating:** Pro tier and above. The Story-to-Scenes feature is THE reason to upgrade from Creator to Pro.

### Feature breakdown

- [ ] **Story input** — paste narrative text (anywhere from a paragraph to a full short script)
- [ ] **Scene decomposition** — GPT-4o or Claude breaks the story into scenes, each with:
  - Setting + atmosphere
  - Characters present
  - Action/dialogue beats
  - Suggested clip count (1-3 clips per scene typically)
- [ ] **Character extraction** — identify ALL characters in the story; for each:
  - Suggest description
  - Offer: “pick from your Avatars library” / “create new avatar” / “let AI generate one for you”
  - Establish character consistency for the production
- [ ] **Clip prompt generation** — for each clip, AI writes the visual prompt with anti-glitch + audio safeguards baked in
- [ ] **Storyboard review UI** — user sees the full plan before any generation happens; can edit, reorder, remove, add clips
- [ ] **Batch generation** — once approved, all clips queue up and generate in sequence with last-frame chaining preserved
- [ ] **Fallback mode** — manual builder still available; AI Director is a smart starter, not a replacement

### Why Phase 5, not Phase 4

- Manual builder is shipped. AI Director is not. Ship > plan.
- AI Director needs real user data to tune (Rift Feedback Logger will collect this)
- Story-to-scenes is 4-6 focused sessions of work. Doing it pre-launch delays launch by weeks.
- Launching with manual builder gets users; AI Director keeps them upgrading.

-----

## 🎨 PHASE 6 — PRODUCTION STUDIO

**Goal:** A second conversational creative product for ad campaigns, explainer videos, and faceless YouTube content.

**Codename:** Production Studio (final name TBD)

**Output:** Polished ad/explainer videos that combine AI-generated humans, AI-generated product shots (via PhotoRoom), animated text/motion graphics, brand assets, and music — to compete with what big brands run on YouTube.

### Interface (LOCKED — conversational, NOT editor)

- Big video player (shows preview when ready, elegant empty state when idle)
- Below: Rift chat box (extends the same Rift Assistant pattern from clip generation)
- User describes the video they want; Rift asks questions:
  - Video size/aspect ratio
  - Inspiration references (user uploads inspo videos)
  - Brand assets needed
  - Characters needed (AI-generated OR from Avatars library)
  - Tone, pacing, music
- **Gemini Vision API integration** — Rift analyzes inspo videos to understand style, pacing, color grading
- Rift requests upload permissions for missing assets, generates the rest
- Production builds in the background; final video appears in the player
- Export button

### Engineering decisions (LOCKED)

- **Same engine, separate door**: Production Studio uses the same `projects` / `scenes` / `clips` infrastructure as Rift Studio. A `projects.kind = 'movie' | 'campaign'` field distinguishes them.
- **Routes**: `/studio` for Rift Studio, `/production` for Production Studio
- **Both surface on the dashboard** as distinct hero cards
- **Higher tier requirement** likely — TBD when scope solidifies

### Major engineering chunks (each is its own sub-phase)

- [ ] **6.1** — Build Production Studio shell (chat UI, video player, basic flow)
- [ ] **6.2** — Gemini Vision integration for inspo analysis
- [ ] **6.3** — Multi-clip orchestrator (Rift plans, generates, stitches)
- [ ] **6.4** — Text/motion-graphics overlay system (FFmpeg server-side compositing — significant work)
- [ ] **6.5** — Template gallery (pre-made campaign types: product launch, explainer, faceless YouTube intro, etc.)
- [ ] **6.6** — Music/sound effect library integration

### Why Phase 6, not earlier

- Production Studio is BIG (animated text overlay alone is 2-3 weeks of work)
- We need real user signal from Phase 5 first to know what production workflows users actually want
- Building this pre-launch delays Riftvid by months
- Story-to-Scenes (Phase 5) teaches us how to do “AI builds the production” at smaller scale before we do it at full ad-campaign scale

### Reveal strategy

**Production Studio Hero card is BUILT during Phase 4 launch prep, but HIDDEN behind a feature flag.**

- Tile exists in code, gated by `process.env.NEXT_PUBLIC_SHOW_PRODUCTION_STUDIO === 'true'`
- Default `false` for launch
- When ready to reveal (post-Phase 5, somewhere in Phase 6 build), flip the flag
- Reveal includes a multi-element animation cycling through use cases: faceless content, professional ads, explainers, product launches

-----

## 🌟 POST-LAUNCH FUTURE

### AI Glitches Library

**Trigger to build:** 50+ paying users

“Report a glitch” button on completed videos saves to Supabase `glitch_reports` table (fields: `glitch_types`, `refined_prompt`, `scene_description`, `failing_frame_url`). Data feeds continuous improvement of `ANTI_GLITCH_SAFEGUARDS` constant in `rift-assistant/route.ts`. This is a proprietary dataset moat.

### FYP / Discovery Feed

**Trigger to build:** 5,000+ paying users

Public-facing feed of Riftvid creations users opt to share. Discovery, virality, network effect.

### Long-form Episodes

**Possible Studio Pro tier ($299/mo)** — TBD. Unlimited credits + multi-episode production tools. Defer until clear demand from paying Studio users.

### Mobile native apps

iOS + Android. Current PWA flow works on mobile but native unlocks push notifications, better camera/media integration. Deferred until web product proves out.

-----

## 📋 DECISIONS LOG (for context)

These are decisions made across sessions that shape the roadmap:

- **Korapay → Flutterwave** (May 2026) — Korapay KYC stalled; Flutterwave shipped
- **‘team’ → ‘studio’** (June 2026) — naming consistency with ROADMAP
- **Credits roll over forever** (May 2026) — trust signal, prevents the “use it or lose it” anxiety
- **Both subscription + one-time tiers** (May 2026) — Nigerian market includes users without recurring payment habits
- **Production Studio = conversational, NOT editor** (June 2026) — founder’s key insight; avoid out-Adobe-ing Adobe
- **Same engine, two doors** (June 2026) — Rift Studio (movies) + Production Studio (ads) share infrastructure, separate UIs
- **Story-to-Scenes = Phase 5, NOT v1 launch** (June 2026) — discipline call; ship what we have, build AI Director after real user signal
- **Digital Twin retired** (June 2026) — too expensive (HeyGen Enterprise-only), too slow (Synthesia 10 days), and the SMB niche our existing creators are in doesn’t justify the build. Permanent — not “coming later”
- **PhotoRoom Product Animator added** (June 2026) — `/v1/animate` API live April 2026; fits e-commerce/SMB seller niche; replaces Digital Twin slot
- **Production Studio Hero built but hidden** (June 2026) — feature flag gates it; reveal post-Phase 5
- **Production Studio feature flag = hardcoded constant** (June 2026) — `const SHOW_PRODUCTION_STUDIO = false` in dashboard. Simpler than env var; flip to `true` and push to reveal
- **🌍 Global-first positioning** (June 2026) — Riftvid positions as a global product (think Spotify, Notion), NOT “the African one going global” (think Boomplay, Iroko). African market support is a quiet superpower — accent diversity, NGN payments, Pidgin/dialect handling — but the marketing pitch is “Direct your AI movie,” not “Built for Africa.” Goal: avoid the regional positioning ceiling. All marketing copy, homepage, and Rift Assistant default behaviors should reflect this. African features remain — they just aren’t the headline.
- **Homepage = Phase 4.11** (June 2026) — front door doesn’t exist yet; unauthenticated `/` currently bounces to Clerk sign-in (terrible first impression). Build homepage AFTER all in-app features ship so it showcases real product, not mockups
- **Browser title cleanup** (June 2026) — change “Riftvid - AI Video Studio” → “Riftvid” (em-dash tagline pattern screams generic AI startup)
- **Clerk production switch** (June 2026) — currently in Development mode with banner; switch to Production for launch
- **Embedded sign-in flow** (June 2026) — verify `/sign-in` and `/sign-up` use embedded Clerk components, NOT redirect to clerk.accounts.dev (premium products hide their auth provider)

-----

## 🚫 EXPLICITLY OUT OF SCOPE (until trigger)

These are PARKED ideas. They will not be built until their trigger fires. If founder proposes building any of these earlier, Claude must invoke the Discipline Contract.

|Idea                   |Trigger                          |
|-----------------------|---------------------------------|
|AI Glitches Library    |50+ paying users                 |
|FYP / Discovery Feed   |5,000+ paying users              |
|Studio Pro $299 tier   |Clear demand from Studio users   |
|Native mobile apps     |Web product proves out           |
|Digital Twin (revival) |Genuine user request after launch|
|Real-time collaboration|Never (not a Riftvid problem)    |

-----

## 📊 SESSION CADENCE

Riftvid is built in numbered sessions. Each session has:

1. A clearly scoped deliverable
1. A locked plan BEFORE building begins
1. A complete file replacement (not diffs) when shipped
1. A roadmap status check at the end

**Current session: Session 11C-3 continuation** — Phase 2 Flutterwave (DONE), Sidebar wiring (DONE), strategic planning (DONE), ROADMAP update (← right now), then 4.1 punch-list items, then back-button bug, then ship.

-----

> 🎯 **REMINDER TO CLAUDE:** Before any code change in a session, re-read this roadmap. If the founder’s request doesn’t match what’s listed here, invoke the Discipline Contract. The roadmap is the contract.

> 🎯 **REMINDER TO FOUNDER:** This roadmap is your protection. It exists so we ship a real product, not 47 half-finished features. Trust the order. Insist when you must. But insist KNOWINGLY.