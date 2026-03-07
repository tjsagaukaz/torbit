# Torbit

**AI-powered app builder with multi-agent orchestration, governed execution, and one-click shipping.**

Torbit turns natural language into production-ready applications. Describe what you want, and a team of specialized AI agents will plan, build, test, audit, and ship it — to the web or app stores.

---

## How It Works

```
You describe it  →  Agents build it  →  Auditor verifies it  →  You ship it
```

1. **Describe** your app in plain English. Select a platform (Web or iOS) and toggle capabilities like payments, auth, storage, or AI.
2. **Watch** the agent team work in real time — creating files, installing packages, running commands — all inside a sandboxed Linux environment.
3. **Review** the live preview. The Auditor agent runs visual inspection, functional tests, and code hygiene checks before anything reaches you.
4. **Ship** to GitHub, Vercel, Netlify, TestFlight, App Store, or Google Play with one click.

---

## Features

### Multi-Agent Architecture

Torbit orchestrates 9 specialized agents, each with a distinct role:

| Agent | Role | What It Does |
|-------|------|-------------|
| **Planner** | Requirements | Converts vague ideas into structured specs — schemas, APIs, page maps |
| **Architect** | Structure | Scaffolds the project, enforces file-size limits (300 lines max), plans before building |
| **Frontend** | UI/UX | Implements accessible interfaces — WCAG 2.1 AA, mobile-first, 44x44px touch targets |
| **Backend** | APIs & Logic | Routes, database schemas, business logic, error handling |
| **DevOps** | Infrastructure | Environment config, CI/CD, deployment orchestration |
| **QA** | Testing | Self-healing test runner — Playwright E2E + Vitest unit, auto-fixes up to 3 times |
| **Auditor** | Quality Gate | Judges but never fixes — visual inspection, functional rigor, code hygiene |
| **Strategist** | Governance | Protects design decisions across sessions — "the blue sidebar stays blue" |
| **God-Prompt** | System | Principal-level engineering standards enforced across all agents |

Agents are invisible to the user. You talk to **Torbit** — the orchestrator routes to the right agent behind the scenes.

### Governed Execution

Every build passes through quality gates before reaching the user:

- **Protected Invariants** — Design decisions accumulate as rules. The Strategist ensures new work doesn't break what you've already approved.
- **Auditor Gates** — Three-pass verification: visual (screenshots + WCAG), functional (E2E test cycles), and code hygiene (no hallucinated imports, no console errors).
- **Auditor Guarantee** — If the Auditor rejects a build, you don't pay for it. Builder costs are held until the Auditor approves.
- **Signed Audit Bundles** — Every shipped artifact is cryptographically signed with governance metadata for compliance.

### Sandboxed Runtime (E2B Cloud)

Apps run in real Linux environments, not browser emulation:

- Persistent sessions up to 24 hours
- Real npm installs with caching
- Full filesystem access
- Dev server with live preview (Vite on port 5173)
- Build diagnostics with failure classification

### Multi-Platform Shipping

Ship anywhere from a single interface:

| Target | Method |
|--------|--------|
| **GitHub** | Create repo, push code, open PR |
| **Vercel** | Auto-framework detection, environment variables, region selection |
| **Netlify** | Direct deploy with build config |
| **TestFlight** | Expo + EAS build pipeline, Apple credential management |
| **App Store** | App Store Connect submission via ASC API |
| **Google Play** | Android submission with service account auth |

All deployments are tracked as background runs with retry logic, stale-run watchdog, and signed trust bundles.

### Real-Time Collaboration

- Live presence indicators with 30-second heartbeat
- Collaborator count in the builder header
- Activity ledger tracking every agent action
- Supabase realtime subscriptions

### Builder UI

- **Chat Panel** — Streaming agent output with tool call timeline, collapsible action logs, copy button, and message timestamps
- **Preview Panel** — Live app preview with device frames (iPhone SE through 15 Pro Max), orientation toggle, and browser frame
- **Code Editor** — Monaco-powered side-by-side code view
- **File Explorer** — Hierarchical file tree with Cmd+P fuzzy search
- **Tasks Panel** — Background task tracking (builds, deployments)
- **Ship Menu** — One-click deploy dropdown
- **Fuel Gauge** — Real-time token usage indicator

Responsive layout: 3-column on desktop, tabbed mobile shell on smaller screens.

---

## Tech Stack

### Torbit Platform

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19 |
| Styling | Tailwind CSS v4 |
| State | Zustand + Immer |
| Database | Supabase (PostgreSQL + Auth + Realtime) |
| Billing | Stripe |
| Sandbox | E2B Cloud |
| AI Models | OpenAI, Anthropic (Claude), Google (Gemini), Kimi |
| Testing | Vitest, Playwright |

### Generated Apps

| Layer | Technology |
|-------|-----------|
| Framework | SvelteKit 2.x |
| Components | DaisyUI 4.x |
| Styling | Tailwind CSS 3.x |
| Mobile | Expo + React Native (via EAS) |

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm

### Setup

```bash
git clone https://github.com/tjsagaukaz/torbit.git
cd torbit
pnpm install
cp .env.example .env
```

### Environment Variables

**Required (minimum to run):**

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# At least one AI provider
OPENAI_API_KEY=your_key
# ANTHROPIC_API_KEY=your_key
# GOOGLE_GENERATIVE_AI_API_KEY=your_key

# Sandbox
NEXT_PUBLIC_E2B_API_KEY=your_e2b_key
```

**Optional — Shipping:**

```env
# GitHub
GITHUB_TOKEN=your_token

# Vercel
VERCEL_TOKEN=your_token

# Netlify
NETLIFY_TOKEN=your_token

# Mobile (Expo + EAS)
EXPO_TOKEN=your_token
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json
```

**Optional — Billing:**

```env
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
```

**Optional — Governance:**

```env
TORBIT_AUDIT_SIGNING_SECRET=your_secret
TORBIT_AUDIT_SIGNING_KEY_ID=torbit-default
```

**Optional — Infrastructure:**

```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
TORBIT_WORKER_TOKEN=your_worker_token
UPSTASH_REDIS_REST_URL=your_url          # Distributed rate limiting
UPSTASH_REDIS_REST_TOKEN=your_token
```

You can also run `pnpm validate-env` to check which variables are set and which are missing.

### Database

Apply the schema before first run:

```sql
-- Run against your Supabase project
\i supabase/schema.sql
```

### Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Verify

```bash
pnpm exec tsc --noEmit   # Type check
pnpm lint                 # Lint
pnpm test:run             # Run all tests
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        TORBIT                                │
│                                                              │
│   Landing Page ──▶ Auth (Supabase) ──▶ Builder UI (Zustand)  │
│                                            │                 │
│                                            ▼                 │
│   ┌────────────────────────────────────────────────────┐     │
│   │            Agent Orchestrator                      │     │
│   │   God-Prompt → Router → Agent Pipeline             │     │
│   │                                                    │     │
│   │   Planner → Architect → Frontend/Backend           │     │
│   │                    → QA → Auditor → Strategist     │     │
│   └──────────────────────┬─────────────────────────────┘     │
│                          │                                   │
│                          ▼                                   │
│   ┌────────────────────────────────────────────────────┐     │
│   │           E2B Cloud Sandbox (Linux)                │     │
│   │   Filesystem · npm · Dev Server · Test Runner      │     │
│   └──────────────────────┬─────────────────────────────┘     │
│                          │                                   │
│            ┌─────────────┼─────────────┐                     │
│            ▼             ▼             ▼                     │
│      ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│      │  GitHub   │  │  Vercel  │  │  Mobile  │              │
│      │  Netlify  │  │  Railway │  │  (Expo)  │              │
│      └──────────┘  └──────────┘  └──────────┘              │
│                                                              │
│   ┌────────────────────────────────────────────────────┐     │
│   │  Supabase  │  Stripe  │  Governance  │  Metrics    │     │
│   └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### Key Directories

```
src/
├── app/
│   ├── page.tsx              # Landing page
│   ├── builder/              # Builder UI
│   ├── dashboard/            # Project management + billing
│   ├── login/                # Auth flow
│   └── api/
│       ├── chat/             # Agent orchestration endpoint
│       ├── e2b/              # Sandbox management
│       ├── ship/             # GitHub, deploy, mobile shipping
│       ├── background-runs/  # Async task execution
│       └── governance/       # Audit bundle signing
├── components/
│   ├── builder/              # Chat, preview, sidebar, file explorer
│   ├── auth/                 # Login/signup forms
│   └── ui/                   # Shared components (logo, spinners)
├── lib/
│   ├── agents/               # Agent prompts + orchestrator
│   ├── tools/                # Tool definitions + executor
│   ├── design/               # Design system + DaisyUI guidance
│   ├── mobile/               # Mobile pipeline + templates
│   ├── ship/                 # Trust bundles
│   ├── intent/               # Message classification
│   ├── supervisor/           # Provider health + failover
│   ├── metrics/              # Telemetry + success tracking
│   └── runtime/              # Build diagnostics
├── store/
│   ├── builder.ts            # Core app state
│   ├── governance.ts         # Protected invariants + audit
│   ├── fuel.ts               # Token billing
│   ├── terminal.ts           # Terminal output
│   └── ledger.ts             # Activity log
├── providers/
│   ├── E2BProvider.tsx       # Sandbox lifecycle
│   └── AuthProvider.tsx      # Auth context
└── hooks/
    ├── useE2B.ts             # Sandbox operations
    └── useProjectPresence.ts # Collaboration presence
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | Agent orchestration + streaming |
| `/api/e2b` | POST | Sandbox create/execute/kill |
| `/api/ship/github` | POST | Repo init, push, PR |
| `/api/ship/deploy` | POST | Vercel/Netlify/Railway deploy |
| `/api/ship/mobile` | GET/POST | Mobile pipeline diagnostics + submission |
| `/api/background-runs` | GET/POST | Async task management |
| `/api/background-runs/[runId]` | GET/PATCH | Individual run status |
| `/api/background-runs/dispatch` | POST | Worker-auth task dispatch |
| `/api/background-runs/worker` | GET/POST | Cron-driven worker + stale-run watchdog |
| `/api/governance/sign-bundle` | POST | Cryptographic audit signing |

---

## Billing

Torbit uses a **fuel-based billing model** powered by Stripe:

- **Fuel** = tokens consumed by agent work
- **Cost multipliers** vary by model tier (Flash 1x, Kimi 0.9x, Sonnet 5x, Opus 8.3x)
- **Auditor Guarantee** — builder costs are held until the Auditor approves; rejected builds are refunded
- **Top-ups** available via Stripe checkout (500, 2,500, or 10,000 fuel packs)

---

## Troubleshooting

### Mobile pipeline blocked
- Verify `EXPO_TOKEN` is set
- Check iOS credentials (Apple App Specific Password or ASC API key trio)
- Check Android credentials (Google Service Account JSON)
- Run `GET /api/ship/mobile` for diagnostics

### Signed bundle creation fails
- Verify `TORBIT_AUDIT_SIGNING_SECRET` is set
- Ensure the request is authenticated

### Collaboration/presence not updating
- Apply latest `supabase/schema.sql`
- Enable Supabase realtime for `project_presence` and `background_runs` tables
- Verify RLS policies exist for authenticated users

### Background runs stuck
- Check worker cron is running (`/api/background-runs/worker`)
- Verify auth headers (`x-torbit-worker-token` or bearer `CRON_SECRET`)
- Default watchdog timeout is 600 seconds

---

## License

Proprietary. All rights reserved.
