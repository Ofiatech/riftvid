<!-- BEGIN: nextjs-agent-rules -->
# This is NOT the Next.js you know
This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END: nextjs-agent-rules -->

---

# Riftvid — Project Context for AI Assistants

> This section provides project-specific context. The auto-managed section above is maintained by Next.js itself — do not modify it.

## Project Overview

**Riftvid** is a premium AI video generation platform — a HeyGen competitor focused on African creators (especially Nigerian content creators) and voice/accent diversity.

**Stack:**
- Next.js 16.2.4 (App Router, Turbopack)
- TypeScript
- Tailwind CSS v4
- Clerk (authentication)
- OpenAI API (GPT-4o for vision, GPT-4o-mini for text)
- Vercel (deployment)
- Replicate (planned, for video generation)

**Live at:** https://riftvid.vercel.app
**Repo:** https://github.com/Ofiatech/riftvid

---

## Architecture

```
app/
├── api/
│   └── rift-assistant/
│       └── route.ts          # OpenAI prompt refinement endpoint
├── sign-in/[[...sign-in]]/   # Clerk sign-in pages
├── sign-up/[[...sign-up]]/   # Clerk sign-up pages
├── layout.tsx                # Root layout with ClerkProvider
├── page.tsx                  # Main dashboard (single-file architecture)
└── globals.css               # Tailwind v4 imports + custom utilities
middleware.ts                 # Clerk auth protection (async pattern for Next 16)
```

**Note:** `app/page.tsx` is currently a single large file containing Sidebar, Topbar, HeroCard, ToolCard, VideoCard, NewGenerationModal, and Dashboard components. This is intentional during early build for ease of iteration. **Do NOT split into separate files yet** — wait until founder explicitly requests refactor.

---

## Critical Next.js 16 Gotchas

These have already burned us — do NOT repeat:

- **Clerk middleware:** Must use `clerkMiddleware(async (auth, request) => { await auth.protect(); })` — NOT the old `auth().protect()` pattern
- **Tailwind v4:** Use `@import "tailwindcss";` in globals.css — NOT `@tailwind base/components/utilities`
- **File naming:** `middleware.ts` NOT `middleware,ts` (commas make Next.js skip it silently)
- **Browser downloads:** Watch for auto-renamed files like `route (1).ts` — always verify exact filename
- **Folder names with `[[...param]]`:** VS Code may reject initially — create with simple name first, then rename

---

## Code Conventions

### Styling
- Color palette: `#050505` (bg), `#0a0a0b` (cards), `#1f2937` (borders), purple-500 to blue-600 for accents
- Custom utility classes in globals.css: `lift`, `grain`, `glass`, `glass-strong`, `pulse-dot`, `fade-up`
- Tailwind classes inline only — no CSS modules
- Border radius: `rounded-xl` for cards, `rounded-lg` for buttons

### TypeScript
- Functional components with hooks
- Strict typing on all API routes
- Avoid `any` unless truly necessary

### State management
- React state updates are async — pass values directly when needed immediately, don't rely on `setState` returning before next operation (we hit this exact bug)

---

## Founder Context

**Nweze Michael** (GitHub: Ofiatech) is the non-technical founder. Communication style:
- Step-by-step instructions needed (assume nothing)
- Specify exact terminal commands ("run this one at a time")
- Windows PowerShell environment — use `Remove-Item`, not `rm`
- Local path: `C:\riftvid\riftvid\`
- Sends photo screenshots of laptop screen (not digital)
- Strong product instincts despite being non-technical (caught important bugs himself)

**Workflow expectations:**
- Localhost test before push to production
- Clear, specific commit messages
- VS Code on Windows 11 Samsung laptop
- Needs explicit Git/terminal guidance every session

---

## Major Future Features — DO NOT BUILD UNLESS REQUESTED

### Scene Sequencer (The Moat)
**Working name:** "Rift Sequence" or "StoryRift" (TBD)

**Concept:** AI video models cap at 10s per generation. Scene Sequencer chains them for full stories.

**How it works:**
1. User writes full story prompt
2. Rift Assistant splits into 10s scenes
3. Each scene generated sequentially
4. **Last frame of Scene N becomes input image for Scene N+1** — preserves character, outfit, environment
5. User reviews/regenerates/reorders scenes
6. Export numbered MP4s for CapCut OR server-side FFmpeg stitching

**When to build:** Only after Phase 1 (basic generation) and Phase 2 (payments) live AND 100+ paying users validate. Premium tier feature, not MVP.

See `ROADMAP.md` for full spec.

### Other planned features (later)
- Brand Kit (saved colors, fonts, logos)
- Digital Twin (photoreal AI avatars from 2-min footage)
- Translate Video (40+ languages with lip-sync)
- Voice cloning
- Mobile apps via Capacitor (iOS + Android)

---

## Launch Status

**Currently:** Stealth-build mode. Founder waiting for dividend before paid launch. Using waiting period to build Scene Sequencer + payment infrastructure properly rather than rushing to market.

**Next milestones:**
1. Real video generation API integration (Session 3)
2. Credits + Stripe payments
3. Scene Sequencer (the moat)
4. Beta program with 10-20 Nigerian content creators
5. Polished public launch with waitlist

See `ROADMAP.md` for detailed phasing and launch strategy.
