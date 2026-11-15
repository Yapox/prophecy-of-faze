# The Oracle: Gemini chat

## Current hosting and optional provider context

The frontend is published on GitHub Pages. The Oracle runs in the existing Supabase project as `supabase/functions/oracle/index.ts`, sharing its request handler with the local Node endpoint. No Vercel account is required. Set `GEMINI_API_KEY` privately in Supabase's Edge Function secrets, deploy `oracle`, then configure Pages `VITE_ORACLE_URL=https://gkhzdoqpqjutuonysdpw.supabase.co/functions/v1/oracle`. The function permits `https://yapox.github.io` by default. See [DEPLOYMENT.md](DEPLOYMENT.md#oracle-server) for commands and activation checks. Without a configured endpoint, Pages displays an unavailable notice.

Supabase's platform JWT verification remains enabled. The handler also verifies the user through Supabase Auth and reads match records through that user's database permissions. Browser requests include the user's bearer token and public publishable key. The Edge Function reads Supabase-injected public keys, with a legacy anon-key fallback; it does not use a service-role key.

When server `PANDASCORE_API_TOKEN` is present, CS2 questions may include a validated, bounded recent-result sample from PandaScore. The source panel displays results, sample counts, retrieval time, and coverage limits. No player performance statistics or win probability is supplied. Missing provider context never becomes invented model facts. The client timeout is now 40 seconds, allowing provider reads plus the 20-second Gemini timeout.

After applying the new migration, enable `ORACLE_DURABLE_RATE_LIMIT=true` for shared five-per-user/minute and 500-total-per-UTC-day reservations. Provider spending limits and the actual audience/provider terms still need operator configuration.

## Enable locally

1. Create a Gemini API key in your Google AI project. Follow [Google's API key guide](https://ai.google.dev/gemini-api/docs/api-key).
2. Add `GEMINI_API_KEY` to the ignored `.env.local` file. Keep the existing public Supabase configuration. Do not put the Gemini key in a `VITE_` variable, chat, or Git.
3. The default server model is `gemini-3.5-flash-lite`. Set `GEMINI_MODEL` only if you need another compatible text model available to your project. Model availability is documented by [Google](https://ai.google.dev/gemini-api/docs/models).
4. Restart `npm run dev` after changing environment variables. Sign in with an email-confirmed account, then open `#oracle` and choose a published market.
5. Ask a question, then a follow-up. The second request includes recent successful chat turns. Switching markets, signing out, leaving the page, or choosing New chat clears the conversation.

For Supabase production, follow the deployment steps above. Local Vite development continues to use `/api/oracle`. The Node adapter and `vercel.json` remain available for optional Node hosting.

## Data flow

React sends `{ marketId, message, history }` to the configured Oracle URL with the Supabase session bearer token and public `apikey` header. In production this is `POST /functions/v1/oracle`; local Vite uses `POST /api/oracle`. The shared handler verifies the user, reads the selected market and match through the user's database permissions, and calls Gemini's [generateContent API](https://ai.google.dev/api/generate-content). It supplies current match context, contract rules, and validated `user`/`model` conversation contents.

The app does not attach email, wallet, position history, or session credentials to the Gemini payload. User questions and previous messages are sent to Gemini, so personal information typed by users will be included. The app stores no chat rows or browser-storage transcript. Provider and hosting data handling still requires launch review; this does not assert that external providers retain nothing.

Only complete prior turns are included, up to three, with 1,000 characters per user message and 4,000 per model response. Request bodies are capped at 64 KiB. The server ignores client-supplied model/context configuration. It re-reads the match on every question and requests concise plain-text replies. Rendered replies do not execute HTML or trigger purchases, wallet updates, or settlement.

The server uses five requests per user per minute per process. Enabling the optional database reservation adds shared limits across instances after the migration is applied. Provider limits may also apply. The server times out Gemini requests after 20 seconds and the client after 40 seconds, allowing time for provider context reads. Errors restore the question in the composer for a deliberate retry. Cancelling a browser request may not stop already-started server/provider work, but stale responses cannot appear in a different conversation.

## Verification

- `npm test`: conversation validation, authentication/market-access guards, server model selection, provider quotas/empty replies, rate limiting, account-data exclusion, native Edge requests/CORS, and bounded streamed bodies.
- `npm run check:chat`: the actual React chat, API helper, and endpoint with controlled provider/database responses. Covers sign-in, suggestions, follow-ups, duplicate protection, failed-question retry, New chat, changing markets during a request, stale-response rejection, and practice/logout behavior.
- `npm run build`: production frontend compilation.
- `npx --yes deno check --config supabase/functions/oracle/deno.json supabase/functions/oracle/index.ts`: check the Supabase entry point and its dependencies in Deno.

These controlled checks make no live Gemini requests or Supabase changes. The published frontend has since been inspected in headless Chromium, and live account integration passed separately. A live PandaScore read also succeeded, although the bounded 200-fixture sample contained no qualifying FaZe/fnatic results. The Supabase Edge Function is prepared and Deno-checked; live deployment needs a Supabase CLI login and the private Gemini secret. An actual signed-in Gemini reply is still unverified. See [release status](RELEASE_STATUS.md).
