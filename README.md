# Prophecy of FaZe

React frontend for the virtual coin prediction backend in `supabase/migrations`.

## Run locally

1. Install Node.js 20 or newer, then run `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Supabase project URL and **public publishable key**. Never put a service role key or database password in a Vite variable.
4. Run `npm run dev` and open the URL shown by Vite.

The Supabase migration must already be applied to the project. Sign up or sign in before loading matches and markets. If email confirmation is enabled, confirm the account before signing in. Matches and markets are created by a trusted backend; the browser only reads them. Sign-in, loading, fetch errors, and empty results have separate states.

The frontend supports sign-up, sign-in, wallet balance, matches, YES/NO purchases, safe retries with the same request ID, recent transactions, and the leaderboard. Purchases use virtual coins with no cash value. Pending purchase intent is kept in per-user session storage so a lost response can be retried without a second debit.

See the [frontend integration contract](https://github.com/Yapox/prophecy-of-faze/blob/main/docs/FRONTEND_INTEGRATION.md) for the backend's exact table and RPC behavior.

## Odyssey frontend

The active application is `src/OdysseyApp.jsx`, using React, Vite, and Tailwind CSS. The interface uses obsidian black, antique gold, subtle crimson, and serif display headings. The landing page follows Odysseus, Athena, Poseidon, and Ithaca across four scroll-linked chapters with transparent marble-inspired artwork. `src/cinematic.css` supplies the dark palette and responsive layouts. `src/App.jsx` remains a compatibility export.

Motion for React is the only animation library. Each chapter links opacity and a small vertical offset to its scroll position. Artwork peaks at 17% opacity, sits behind content, and cannot intercept clicks. Small screens use smaller WebP assets and 40% of the desktop parallax distance. Reduced-motion preference mounts static artwork with no scroll-animation subscription. Poseidon's ocean lines move with scrolling, with no looping ambient animation. See [artwork and verification notes](docs/CINEMATIC_LANDING.md).

The navigation includes Home, Markets, Portfolio, Leaderboard, The Oracle, and draft Terms and Privacy pages. Markets support game filters, search, YES/NO selection, whole-number contract quantities, a cost/return preview, confirmation, and pending-request retries. The existing backend uses fixed payouts: one contract costs one virtual coin and returns two if correct. These are not variable exchange prices or predicted probabilities.

Practice mode stores seeded fixtures, positions, ledger entries, and a 1,000-coin starting wallet in this browser’s local storage. Practice and account data are separate. Portfolio includes tools to resolve or cancel sample fixtures and reset the practice wallet. Sample schedules, teams’ participation, and event names do not claim to represent real fixtures. Leaderboard practice mode contains only the current practice user.

Account mode uses the configured Supabase project. Email confirmation is enabled in the currently connected project. After confirmation, sign in here to load account data. In Supabase Auth URL settings, allow the local origin you use (`http://127.0.0.1:5173` or `http://localhost:5173`) and your deployed Vercel origin. Never reset an existing account wallet to repeat a test.

Configured projects open account mode by default. Sample matches appear only when practice is explicitly selected. Signed-in records refresh every 30 seconds while visible, on focus/visibility/reconnect, and after purchases. The account notice displays the last successful sync time. PandaScore imports and trusted-backend settlements appear through these database reads; the frontend does not run import or settlement tools.

## The Oracle and Vercel

`api/oracle.js` is a Vercel Node endpoint. The Vite configuration exposes the same handler locally. Set `GEMINI_API_KEY` only in server environment variables (`.env.local` for local development, Vercel settings for deployment). The server defaults to `gemini-3.5-flash-lite`; optionally set `GEMINI_MODEL` to another compatible text model available to your Google AI project. Neither variable has a `VITE_` prefix. The server also reads the Supabase URL and public key from `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`, falling back to the existing Vite public variables.

The Oracle supports questions, follow-ups, suggested prompts, and New chat. It keeps chat messages in page memory and clears them on market/account changes or leaving the page. Each request sends the question and up to three prior successful turns. The endpoint verifies the caller with Supabase, reads the selected match/market again through the caller’s database permissions, and sends that record and fixed-payout rules to Gemini. The app does not attach account details, sessions, or prediction history. Anything users type in chat is included, so the UI asks them to avoid personal information. Responses render as plain text.

The endpoint limits requests to five per user per minute per process, caps question/history sizes, and handles quotas, provider failures, and timeouts. Durable rate limiting and provider spending limits need deployment review before public use. A missing Gemini key produces an explicit unavailable message, preserving the question for retry. Practice briefs are not presented as AI-generated. Verified performance statistics remain future work; imported PandaScore fixture records are read from Supabase. See [Oracle chat setup and checks](docs/ORACLE_CHAT.md).

`vercel.json` declares the Vite build and `dist` output. Hash navigation requires no SPA rewrite. Deploy with the public Supabase variables and server-only Gemini configuration. No deployment has been performed from this workspace.

Implementation references: [Tailwind’s Vite integration](https://tailwindcss.com/docs/installation/using-vite), [Gemini content generation](https://ai.google.dev/api/generate-content), [Supabase user verification](https://supabase.com/docs/reference/javascript/auth-getuser), and [Vercel functions](https://vercel.com/docs/functions/quickstart).

## Verification

- `npm test`: trade calculations, retries, settlement/refunds, ledger reconciliation, storage fallback, and Oracle authorization/data minimization with a mocked provider.
- `npm run check:render`: the app and representative market card render through Vite.
- `npm run check:flow`: a DOM-based practice journey covering a duplicate confirm click, wallet debit, portfolio, winning settlement, transaction history, leaderboard, game filtering, and legal navigation.
- `npm run check:account`: controlled Supabase responses covering sign-in gating, automatic refresh, newly imported cards, purchases/retries, wallet updates, resolved positions, and logout cleanup. This does not read or modify deployed records.
- `npm run check:chat`: React chat through the real client helper and server handler with controlled Gemini/Supabase responses, including follow-ups, errors/retries, duplicate submits, clearing, and stale replies after changing matches.
- `npm run check:cinematic`: real headless Chromium checks for desktop/mobile layouts, four scroll-linked figures, responsive image loading, reduced motion, keyboard focus, action contrast, calculator-to-confirmation trading, and portfolio/leaderboard/legal navigation. Run `npx playwright install chromium --only-shell` once if the test browser is missing, and start the local Vite server first.
- `npm run build`: production compilation.

The public Supabase key was accepted by the deployed Auth settings endpoint. Signed-in signup/purchase/payout checks still require an email-confirmed test account. The cinematic landing page has been inspected in headless Chromium at desktop and mobile widths, with overflow checks at 320, 390, 768, and 1440 pixels, reduced-motion checks, keyboard skip-link checks, and a completed browser-local practice trade. These checks do not verify live account purchases or settlement. Screenshots and the browser report are saved under ignored `artifacts/cinematic/`.

The Terms and Privacy pages are drafts. Operator/contact details, eligibility, jurisdiction, retention, and account deletion/export processes still need review.
