# The Oracle: Gemini chat

## Enable locally

1. Create a Gemini API key in your Google AI project. Follow [Google's API key guide](https://ai.google.dev/gemini-api/docs/api-key).
2. Add `GEMINI_API_KEY` to the ignored `.env.local` file. Keep the existing public Supabase configuration. Do not put the Gemini key in a `VITE_` variable, chat, or Git.
3. The default server model is `gemini-3.5-flash-lite`. Set `GEMINI_MODEL` only if you need another compatible text model available to your project. Model availability is documented by [Google](https://ai.google.dev/gemini-api/docs/models).
4. Restart `npm run dev` after changing environment variables. Sign in with an email-confirmed account, then open `#oracle` and choose a published market.
5. Ask a question, then a follow-up. The second request includes recent successful chat turns. Switching markets, signing out, leaving the page, or choosing New chat clears the conversation.

For Vercel, configure the same server environment variables and public Supabase variables in the deployment settings, then redeploy. No deployment is performed by these changes.

## Data flow

React sends `{ marketId, message, history }` to `POST /api/oracle` with the Supabase session bearer token. The endpoint verifies the user, reads the selected market and match through the user's database permissions, and calls Gemini's [generateContent API](https://ai.google.dev/api/generate-content). It supplies current match context, contract rules, and validated `user`/`model` conversation contents.

The app does not attach email, wallet, position history, or session credentials to the Gemini payload. User questions and previous messages are sent to Gemini, so personal information typed by users will be included. The app stores no chat rows or browser-storage transcript. Provider and hosting data handling still requires launch review; this does not assert that external providers retain nothing.

Only complete prior turns are included, up to three, with 1,000 characters per user message and 4,000 per model response. Request bodies are capped at 64 KiB. The server ignores client-supplied model/context configuration. It re-reads the match on every question and requests concise plain-text replies. Rendered replies do not execute HTML or trigger purchases, wallet updates, or settlement.

The server uses five requests per user per minute per process. This is an MVP limit, not a distributed quota. Provider limits may also apply. The server times out Gemini requests after 20 seconds and the client after 25 seconds. Errors restore the question in the composer for a deliberate retry. Cancelling a browser request may not stop already-started server/provider work, but stale responses cannot appear in a different conversation.

## Verification

- `npm test`: conversation validation, authentication/market-access guards, server model selection, provider quotas/empty replies, rate limiting, and account-data exclusion.
- `npm run check:chat`: the actual React chat, API helper, and endpoint with controlled provider/database responses. Covers sign-in, suggestions, follow-ups, duplicate protection, failed-question retry, New chat, changing markets during a request, stale-response rejection, and practice/logout behavior.
- `npm run build`: production frontend compilation.

These checks make no live Gemini requests or Supabase changes. At implementation time, the local Gemini key was not configured and browser automation was unavailable. A real signed-in provider response and desktop/mobile visual inspection remain pending.
