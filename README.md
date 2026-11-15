# Prophecy of FaZe

React frontend for the virtual coin prediction backend in `supabase/migrations`.

**Live website:** https://yapox.github.io/prophecy-of-faze/

See [deployment and activation](docs/DEPLOYMENT.md) for GitHub Pages, the separate Oracle server, recovery links, and match/payout automation. [Release status](docs/RELEASE_STATUS.md) distinguishes implemented features from pending deployment and live verification.

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

The navigation includes Home, Markets, Portfolio, Leaderboard, and The Oracle. Markets support game filters, search, YES/NO selection, whole-number contract quantities, a cost/return preview, confirmation, and pending-request retries. The existing backend uses fixed payouts: one contract costs one virtual coin and returns two if correct. These are not variable exchange prices or predicted probabilities.

Practice mode stores seeded fixtures, positions, ledger entries, and a 1,000-coin starting wallet in this browser’s local storage. Practice and account data are separate. Portfolio includes tools to resolve or cancel sample fixtures and reset the practice wallet. Sample schedules, teams’ participation, and event names do not claim to represent real fixtures. Leaderboard practice mode contains only the current practice user.

Account mode uses the configured Supabase project. Email confirmation is enabled in the currently connected project. After confirmation, sign in here to load account data. In Supabase Auth URL settings, allow the published Pages URL and recovery URL listed in [deployment settings](docs/DEPLOYMENT.md), plus any local or Vercel URLs actually used. Never reset an existing account wallet to repeat a test.

Configured projects open account mode by default. Sample matches appear only when practice is explicitly selected. Signed-in records refresh every 30 seconds while visible, on focus/visibility/reconnect, and after purchases. The account notice displays the last successful sync time. PandaScore imports and trusted-backend settlements appear through these database reads; the frontend does not run import or settlement tools.

## The Oracle on Supabase

`supabase/functions/oracle/index.ts` runs The Oracle as a Supabase Edge Function. Its shared handler also powers `api/oracle.js` for local Vite development and optional Node hosting. Set `GEMINI_API_KEY` privately in Supabase's Edge Function secrets, or in ignored `.env.local` for local development. The default model is `gemini-3.5-flash-lite`; `GEMINI_MODEL` can select another compatible text model available to your Google AI project. Never give either credential a `VITE_` prefix. Supabase injects the server's project URL and public keys; queries use the signed-in caller's token and database permissions.

The Oracle supports questions, follow-ups, suggested prompts, and New chat. It keeps chat messages in page memory and clears them on market/account changes or leaving the page. Each request sends the question and up to three prior successful turns. The endpoint verifies the caller with Supabase, reads the selected match/market again through the caller’s database permissions, and sends that record and fixed-payout rules to Gemini. The app does not attach account details, sessions, or prediction history. Anything users type in chat is included, so the UI asks them to avoid personal information. Responses render as plain text.

The endpoint limits requests to five per user per minute per process, caps question/history sizes, and handles quotas, provider failures, and timeouts. Optional shared quotas require the new database migration and server setting. A missing Gemini key produces an explicit unavailable message, preserving the question for retry. Practice briefs are not presented as AI-generated. Imported fixtures are read from Supabase; optional validated PandaScore result samples provide bounded context with visible coverage limits. Player statistics remain future work. See [Oracle chat setup and checks](docs/ORACLE_CHAT.md).

The frontend stays on GitHub Pages. Deploy only the `oracle` function to the existing Supabase project, then set GitHub Actions variable `VITE_ORACLE_URL=https://gkhzdoqpqjutuonysdpw.supabase.co/functions/v1/oracle` and rebuild Pages. The Edge Function permits `https://yapox.github.io` by default; `ORACLE_ALLOWED_ORIGINS` can override the exact allowed origins. See [deployment steps](docs/DEPLOYMENT.md#oracle-server). A Vercel account is not required. Live activation still requires Supabase deployment access and the private Gemini secret; controlled tests do not prove a real Gemini reply.

Implementation references: [Tailwind’s Vite integration](https://tailwindcss.com/docs/installation/using-vite), [Gemini content generation](https://ai.google.dev/api/generate-content), [Supabase user verification](https://supabase.com/docs/reference/javascript/auth-getuser), and [Supabase Edge Functions](https://supabase.com/docs/guides/functions).

## Verification

- `npm test`: trade calculations, retries, settlement/refunds, ledger reconciliation, storage fallback, and Oracle authorization/data minimization with a mocked provider.
- `npm run check:render`: the app and representative market card render through Vite.
- `npm run check:flow`: a DOM-based practice journey covering a duplicate confirm click, wallet debit, portfolio, winning settlement, transaction history, leaderboard, game filtering, and fallback from removed routes.
- `npm run check:account`: controlled Supabase responses covering sign-in gating, automatic refresh, newly imported cards, purchases/retries, wallet updates, resolved positions, and logout cleanup. This does not read or modify deployed records.
- `npm run check:chat`: React chat through the real client helper and server handler with controlled Gemini/Supabase responses, including follow-ups, errors/retries, duplicate submits, clearing, and stale replies after changing matches.
- `npm run check:cinematic`: real headless Chromium checks for desktop/mobile layouts, four scroll-linked figures, responsive image loading, reduced motion, keyboard focus, action contrast, calculator-to-confirmation trading, portfolio/leaderboard navigation, and creator credits. Run `npx playwright install chromium --only-shell` once if the test browser is missing, and start the local Vite server first.
- `npm run build`: production compilation.

Live account integration passed against the published Pages site and Supabase: the signup trigger granted 1,000 coins, both FaZe questions displayed, YES/NO purchases updated the wallet, duplicate retries did not debit twice, and history, leaderboard, session persistence and logout worked. The temporary admin-confirmed account was deleted afterward. Actual signup/recovery email delivery and live-match payouts remain unverified. See [release status and the sanitized report](docs/RELEASE_STATUS.md).

The cinematic landing page has been inspected in headless Chromium at desktop and mobile widths, with overflow checks at 320, 390, 768, and 1440 pixels, reduced-motion checks, keyboard skip-link checks, and a completed browser-local practice trade. Published recovery/activity checks also passed at 320, 390 and 1440 pixels. Screenshots and browser reports are saved under ignored `artifacts/`.

The footer credits Aashaswa Khakurel and Subigya Poudel for the HackUTA 2026 project. Terms and Privacy pages were removed at the project owner's request; old hashes fall back to Home.

## Completion updates

Password reset is available from Sign in > Forgot password. Recovery links open a password-confirmation form; signup and recovery preserve the GitHub repository path. The exact callback URLs must be allowed in Supabase Auth settings.

The leaderboard shows current/longest daily prediction streaks, winning-market streaks, a seven-day activity history, and two daily participation goals. Days use UTC. Multiple purchases on a day do not increase the day streak, and winning streaks use each settled market's net profit. Goals award no extra coins.

The Oracle can optionally include a source-labeled recent PandaScore result sample. It scans at most 200 past CS2 records, caches reads for five minutes, and includes up to five validated results per team. It does not claim complete recent form, player statistics, probabilities, or verified rosters. Provider errors preserve chat without inventing statistics.

The new automation migration and `sync-pandascore-markets.cjs` publish fixtures and questions atomically, handle untraded reschedules, and refund open positions for source drift while preserving purchased terms for review. Audited settlements record provider evidence in the existing payout transaction. GitHub jobs stay in dry-run until their explicit repository variables are activated. The migration supplies optional shared Oracle quotas.

Additional checks: `npm run check:database` executes actual SQL in isolated PostgreSQL; `npm run check:automation` runs offline fixture and settlement tests. These do not change the live Supabase project.
