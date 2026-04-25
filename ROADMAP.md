# Riftvid Roadmap

> Founder: Nweze Michael (Ofiatech)
> Last updated: April 25, 2026
> Status: Pre-launch · Stealth-build mode

---

## North Star

**Make Riftvid the AI video platform built for African creators that anyone in the world can use.**

Voice/accent diversity, Nigerian Gen Z aesthetics, scene-based storytelling — these aren't features, they're identity.

---

## Phase 1 — Core MVP ✅ (In Progress, Sessions 1-2)

**Goal:** Generate ONE 10-second video from image + prompt, polished end-to-end.

- [x] Premium dashboard UI (Apple × HeyGen aesthetic)
- [x] Clerk authentication (Google + Email)
- [x] Vercel deployment + auth-protected routes
- [x] Mobile-responsive HeyGen-style sidebar
- [x] Rift Assistant with vision (sees uploaded images)
- [x] Dynamic 3-4 question chat flow with custom answer fallback
- [x] File picker with thumbnail preview
- [x] OpenAI integration for prompt refinement
- [ ] Real video generation API (Replicate: Kling/Veo3/Sora)
- [ ] Render progress UI + job status polling
- [ ] User video library (replace mock data)

**Decision point:** Once one video generates beautifully, move to Phase 2.

---

## Phase 2 — Monetization Foundation

**Goal:** People can pay. Riftvid earns revenue from day one of launch.

- [ ] Credits system (deduct on generation, track per user)
- [ ] Stripe integration (checkout + webhooks)
- [ ] Pricing tiers
  - Free: 5 credits/month
  - Creator: $19/mo, 100 credits
  - Pro: $49/mo, 300 credits + Scene Sequencer access
  - Studio: $149/mo, 1000 credits + commercial license
- [ ] Account/billing page
- [ ] Failed payment recovery flows
- [ ] Credit top-ups (one-time purchases)

---

## Phase 3 — Scene Sequencer 🎬 (THE MOAT)

**Codename:** Working title — **"Rift Sequence"** or **"StoryRift"** (TBD)

**The big idea:** Most AI models cap at 10 seconds per video. Riftvid lets creators generate FULL stories by chaining scenes together with character + scene consistency.

### How it works (technical spec)

1. **User writes the full story** in a long prompt
2. **Rift Assistant breaks it into scenes** (10s chunks, suggested by AI)
3. **Scene 1 generates** from user's image + first scene prompt
4. **System extracts last frame** of generated video automatically (FFmpeg server-side)
5. **Scene 2 generates** using last frame as input image + next scene prompt
6. **Repeat for N scenes** — character/outfit/setting carry forward
7. **User reviews each scene**, can:
   - Approve and continue
   - Regenerate (cost: 1 credit)
   - Cut to new scene (upload new reference image)
   - Change camera angle (same character, different angle)
8. **Export pipeline:**
   - Each scene saves as separate MP4
   - Drag-drop reorder UI
   - One-click export numbered files for CapCut import (Scene_01.mp4, Scene_02.mp4...)
   - Premium tier: server-side FFmpeg stitching to single MP4

### Consistency strategy

- **Character lock:** First scene establishes character; subsequent scenes use last frame + character reference
- **Outfit lock:** Repeat outfit description in each scene's prompt automatically
- **Environment lock:** Reference frame + "same [setting] as previous scene" in prompt
- **Camera lock vs. flex:** User toggles whether camera should hold or change

### Why this is the moat

- HeyGen doesn't do this
- Sora/Veo don't expose chaining UX to non-technical users
- African creators want long-form content (TikTok stories, mini dramas, skits) — current tools force them to manually edit clips together
- Combined with Nigerian Gen Z voice = unmatched value for the demographic

### Build complexity: HIGH

- Video processing infrastructure (FFmpeg on Vercel/AWS)
- Storage for in-progress sequences (Supabase + S3)
- Frame extraction pipeline
- Reorder UI (drag-drop)
- Export pipeline
- Cost management (multiple API calls per story)

**Recommend: Build after 100+ paying users validate basic Riftvid first.**

---

## Phase 4 — Polish & Power Features

- [ ] Brand Kit (saved colors, fonts, logos for consistent videos)
- [ ] Digital Twin (photoreal AI avatars from 2-min footage)
- [ ] Translate Video (40+ languages with lip-sync)
- [ ] Templates library
- [ ] Voice cloning
- [ ] Analytics dashboard for creators
- [ ] Referral program

---

## Launch Strategy 🚀

### The waiting period is a GIFT, not a delay.

Most founders launch too early. You have time to launch from **strength**.

### Build Phase (Now → Dividend Available)

1. Ship Phase 1 + Phase 2 fully
2. Beta-test with 10-20 Nigerian content creators (free access in exchange for feedback + UGC)
3. Polish based on real-world breakage
4. Document everything that needs to scale

### Pre-Launch Phase (last 2-3 weeks before dividend)

1. Build a waitlist
   - WhatsApp groups
   - TikTok teasers (made WITH Riftvid)
   - Twitter/X presence as @riftvid
2. Create 10-15 demo videos showing Riftvid quality
3. Line up 5-10 micro-influencers (1k-50k followers, Nigerian creators)
4. Have a launch sequence ready (email, social, etc.)

### Launch Phase (Dividend arrives)

1. Open access to waitlist FIRST (creates urgency + exclusivity feel)
2. Run paid ads with polished product + social proof
3. Influencers post their already-created Riftvid content same week
4. Lifetime deal for first 100 paying users (revenue boost + lock-in)

### Why this beats "launch fast and iterate"

- AI video market is too crowded — half-baked = invisible
- First impression matters: viral users won't give a 2nd chance
- Nigerian creators specifically value polish (perception is currency)
- A polished launch with 100+ users beats a janky launch with 1000 churned users

---

## Risk Watchlist ⚠️

| Risk | Mitigation |
|------|-----------|
| AI video models change pricing | Use Replicate as middleware — easy to swap providers |
| Veo/Sora launches free competitor | Lean into African identity + Scene Sequencer as moat |
| Costs blow up with vision API | Cache image descriptions; only send image once per session |
| User uploads abusive content | Content moderation API (OpenAI Moderation, free) |
| Single point of failure in dependencies | Document everything, keep architecture simple |

---

## Quarterly Check-ins

Update this file every 90 days to reflect what's shipped, what's blocked, what's next.

**Next review:** July 25, 2026
