# Deployment and activation

## Published frontend

The website is deployed by `.github/workflows/deploy-pages.yml` from `main`:

https://yapox.github.io/prophecy-of-faze/

GitHub Pages serves the React app and optimized artwork. The app reads Supabase through the public publishable key. The server-only Oracle is deployed separately. An unavailable Oracle does not block predictions or practice mode.

Repository Actions variables:

| Name | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Public Supabase project URL. Already configured. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public client key. Already configured. |
| `VITE_ORACLE_URL` | Optional HTTPS Oracle endpoint, e.g. the actual Vercel domain followed by `/api/oracle`. |
| `VITE_OPERATOR_NAME` | Actual project operator, once confirmed. |
| `VITE_SUPPORT_EMAIL` | Actual monitored support email, once confirmed. |

Variable changes require a new Pages build. Do not put private keys in any `VITE_` variable.

## Supabase email links

In Authentication > URL Configuration, configure the published site and permitted signup/recovery redirects:

```text
https://yapox.github.io/prophecy-of-faze/
https://yapox.github.io/prophecy-of-faze/?auth=recovery
```

Add the corresponding exact URLs for a separate full-app deployment or local testing. Password recovery calls `resetPasswordForEmail`, handles `PASSWORD_RECOVERY`, and then calls `updateUser`. Invalid or expired links offer a new reset request. Responses do not disclose whether an email is registered.

## Oracle server

Import `Yapox/prophecy-of-faze` into Vercel using the existing `vercel.json`. The build command is `npm run build`, output `dist`, Node 22. Do not set `VITE_STATIC_HOSTING=true` on Vercel. This deployment serves both the app and `/api/oracle`.

Configure privately in Vercel:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Frontend public project URL; server fallback. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Frontend public key; server fallback. |
| `GEMINI_API_KEY` | Yes | Private Gemini credential. |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-3.5-flash-lite`; confirm availability for the provider project. |
| `ORACLE_ALLOWED_ORIGINS` | For Pages | `https://yapox.github.io` permits the existing Pages frontend. Additional exact origins may be comma separated. |
| `PANDASCORE_API_TOKEN` | For result samples | Private provider token. Chat still works without the sample. |
| `ORACLE_DURABLE_RATE_LIMIT` | After migration | Set `true` after the migration below is applied. |

Set the actual HTTPS server endpoint in GitHub's `VITE_ORACLE_URL`, then rebuild Pages. Browser requests use a Supabase bearer token and explicit CORS. No private Gemini/PandaScore/service-role key reaches the frontend.

The result sample inspects at most 200 recent CS2 fixture records, validates explicit winners and scores, and returns at most five results for each identifiable team. It is not complete form or a probability. Player performance statistics require separately authorized provider coverage and are not implemented. Do not purchase an API upgrade merely to activate this sample.

Review the actual [Gemini terms](https://ai.google.dev/gemini-api/terms), including its audience/age and regional requirements, and configure provider spending limits before enabling it for an audience. The operator and audience decisions remain unconfirmed.

## Match publication and payouts

Apply **only the new migration** to the existing project using its migration owner. Do not rerun the initial migration on an already initialized database:

`supabase/migrations/20261115000000_automation_and_oracle_limits.sql`

It adds:

- An atomic, service-only `sync_pandascore_match` RPC that publishes a fixture and standard prediction question together. A unique index prevents identical open questions for the same match.
- `settle_pandascore_prediction`, which calls the existing payout RPC and records the first provider evidence receipt in the same transaction.
- A service-readable operations ledger and an authenticated Oracle quota reservation function. Quotas allow five requests per user/minute and 500 total per UTC day. Reservations count failed provider attempts too.

If existing duplicate open questions prevent the unique index, stop and review those records. The migration does not delete or merge existing positions.

Server-only GitHub Actions secrets:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
PANDASCORE_API_TOKEN
```

Keep these in repository secrets, never in source or frontend variables. The preferred `sb_secret_` key is used by the scheduled jobs. Local CLI tools also support the documented legacy service-role key.

After applying the migration and reviewing successful dry runs, activate the repository variables independently:

```text
PANDASCORE_SYNC_ENABLED=true
PANDASCORE_SETTLEMENT_ENABLED=true
```

These are operational controls. They default to dry-run until configured. Sync is scheduled at minutes 7 and 37; result checks every 15 minutes. GitHub schedules can be delayed and do not guarantee exact execution times. Both jobs share a concurrency group.

The new sync job uses the known FaZe team ID 3212 and importer validation. When an untraded fixture changes schedule/opponent, it cancels its old open markets and publishes replacement terms. If there are positions, it refunds still-open markets and records `refunded_review_required`, preserving historical identity and terms. The replacement requires manual review. Existing resolved payouts are not reversed. Draws, cancellations, forfeits, ambiguous results, and provider corrections remain explicit operational review cases rather than guessed winners.

Inspect `prediction_operations` and the workflow logs for review cases. `PANDASCORE_AUDIT=true` is already wired into the result workflow; enabling apply therefore requires the new migration.

## Verification and outstanding access

```text
npm test
npm run check:auth
npm run check:account
npm run check:chat
npm run check:database
npm run check:automation
npm run build:pages
```

`check:database` executes both SQL migrations in isolated PGlite PostgreSQL with an Auth schema stub. It verifies actual SQL wallet/RLS/refund/payout/permission/quota behavior. It does not test live Supabase Auth or multi-process production concurrency.

The deployed account checks passed on 2026-11-15 using a temporary admin-confirmed account: 1,000-coin signup trigger, both actual FaZe records, browser YES/NO purchases, wallet debits, duplicate-request protection, history, session persistence, leaderboard and logout. See [release status and evidence](RELEASE_STATUS.md). Actual signup/recovery email delivery remains unverified. A controlled live payout needs coordination with the backend operator or an isolated test project. Do not resolve an actual upcoming match just to make a test pass.

The manually dispatched `Test Deployed Account Integration` workflow can independently test the deployed frontend using an admin-confirmed account generated for that run. It checks the 1,000-coin signup trigger, login, target match questions, eligible 5-coin YES/NO purchases, exact-request retries, history, leaderboard, persistence and logout, then deletes only its tagged temporary account. It never reopens or settles real markets. Purchases are skipped explicitly if no future open imported market exists. The generated email is synthetic and receives no message, so this does not verify signup or recovery email delivery. Its uploaded JSON report contains no passwords or tokens.

Select the workflow's `readiness_only` input to inspect the deployed service-role OpenAPI schema without creating an account or writing data. The JSON `ready` field reports whether both automation RPCs and the operations ledger are exposed. A completed check with `ready: false` means the check ran successfully but deployment is still incomplete. OpenAPI discovery is permission-sensitive, as described by [PostgREST](https://docs.postgrest.org/en/stable/references/api/openapi.html); a missing or unexpected schema is reported as unknown/failure, never ready. On 2026-11-15 at 04:06 UTC, the new objects were absent.

Operator identity, monitored support contact, eligibility/jurisdiction, formal retention, and deletion/export procedures remain draft decisions. The UI explicitly identifies missing details and does not invent commitments.

References: [Supabase recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [redirect allowlists](https://supabase.com/docs/guides/auth/redirect-urls), [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [PandaScore plan coverage](https://developers.pandascore.co/docs/plan-reference).
