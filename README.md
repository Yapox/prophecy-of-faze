# Prophecy of FaZe

React frontend for the virtual coin prediction backend in `supabase/migrations`.

## Run locally

1. Install Node.js 20 or newer, then run `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Supabase project URL and **public publishable key**. Never put a service role key or database password in a Vite variable.
4. Run `npm run dev` and open the URL shown by Vite.

The Supabase migration must already be applied to the project. Sign up or sign in before loading matches and markets. If email confirmation is enabled, confirm the account before signing in. Matches and markets are created by a trusted backend; the browser only reads them. An empty match list means none have been published yet.

The frontend supports sign-up, sign-in, wallet balance, matches, YES/NO purchases, safe retries with the same request ID, recent transactions, and the leaderboard. Purchases use virtual coins with no cash value. Pending purchase intent is kept in per-user session storage so a lost response can be retried without a second debit.

See the [frontend integration contract](https://github.com/Yapox/prophecy-of-faze/blob/main/docs/FRONTEND_INTEGRATION.md) for the backend's exact table and RPC behavior.

## Odyssey frontend

The active application is `src/OdysseyApp.jsx`, using React, Vite, and Tailwind CSS. The interface uses warm ivory, restrained gold, serif display headings, and imagery inspired by Odysseus’s voyage to Ithaca. `src/App.jsx` remains a compatibility export.

The navigation includes Home, Markets, Portfolio, Leaderboard, The Oracle, and draft Terms and Privacy pages. Markets support game filters, search, YES/NO selection, whole-number contract quantities, a cost/return preview, confirmation, and pending-request retries. The existing backend uses fixed payouts: one contract costs one virtual coin and returns two if correct. These are not variable exchange prices or predicted probabilities.

Practice mode stores seeded fixtures, positions, ledger entries, and a 1,000-coin starting wallet in this browser’s local storage. Practice and account data are separate. Portfolio includes tools to resolve or cancel sample fixtures and reset the practice wallet. Sample schedules, teams’ participation, and event names do not claim to represent real fixtures. Leaderboard practice mode contains only the current practice user.

Account mode uses the configured Supabase project. Email confirmation is enabled in the currently connected project. After confirmation, sign in here to load account data. In Supabase Auth URL settings, allow the local origin you use (`http://127.0.0.1:5173` or `http://localhost:5173`) and your deployed Vercel origin. Never reset an existing account wallet to repeat a test.

## The Oracle and Vercel

`api/oracle.js` is a Vercel Node endpoint. The Vite configuration exposes the same handler locally. Set `GEMINI_API_KEY` and `GEMINI_MODEL` only in server environment variables (`.env.local` for local development, Vercel settings for deployment). Choose a model available to your Google AI project. Neither variable has a `VITE_` prefix. The server also reads the Supabase URL and public key from `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`, falling back to the existing Vite public variables.

The endpoint verifies the caller with Supabase, loads the selected market through the caller’s database permissions, and sends match context and fixed-payout rules to Gemini. Account details, sessions, and prediction history are not sent to Gemini. It has a per-process request limit; durable rate limiting and provider spending limits need deployment review before public use. Missing Gemini settings produce an explicit unavailable message. The UI’s sample match brief is not presented as AI-generated. Verified performance statistics and an authorized esports feed remain future work.

`vercel.json` declares the Vite build and `dist` output. Hash navigation requires no SPA rewrite. Deploy with the public Supabase variables and server-only Gemini configuration. No deployment has been performed from this workspace.

Implementation references: [Tailwind’s Vite integration](https://tailwindcss.com/docs/installation/using-vite), [Gemini content generation](https://ai.google.dev/api/generate-content), [Supabase user verification](https://supabase.com/docs/reference/javascript/auth-getuser), and [Vercel functions](https://vercel.com/docs/functions/quickstart).

## Verification

- `npm test`: trade calculations, retries, settlement/refunds, ledger reconciliation, storage fallback, and Oracle authorization/data minimization with a mocked provider.
- `npm run check:render`: the app and representative market card render through Vite.
- `npm run check:flow`: a DOM-based practice journey covering a duplicate confirm click, wallet debit, portfolio, winning settlement, transaction history, leaderboard, game filtering, and legal navigation.
- `npm run build`: production compilation.

The public Supabase key was accepted by the deployed Auth settings endpoint. Signed-in signup/purchase/payout checks still require an email-confirmed test account. Desktop/mobile screenshots, visual overflow checks, and keyboard interaction in a real browser have not been completed because browser automation is unavailable. DOM tests do not substitute for that visual inspection.

The Terms and Privacy pages are drafts. Operator/contact details, eligibility, jurisdiction, retention, and account deletion/export processes still need review.
