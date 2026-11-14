# Backend security tests

Run from the repository root with Node.js and `@electric-sql/pglite` installed in a temporary directory:

```powershell
$reviewTools = Join-Path $env:TEMP 'prophecy-faze-sql-review'
npm.cmd install --prefix $reviewTools --no-save --package-lock=false --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.16
$pgliteModule = Join-Path $reviewTools 'node_modules\@electric-sql\pglite'
node supabase/tests/backend-security.test.cjs $pgliteModule
```

The runner creates a new in-memory PostgreSQL database. It has no cloud connection or deployment commands. It reads the migration file directly and tests it with broad initial table/function grants to mimic Supabase defaults. A minimal `auth.users` / `auth.uid()` shim tests signup initialization, existing users, RLS, and function permissions; it does not reproduce the full Supabase platform.

The suite checks access isolation, forbidden writes, retries, insufficient funds, payout/refund idempotency, ledger uniqueness, and transaction rollback on forced failures. It also checks market closing times and function execution privileges.

Before deploying, use a **disposable local Supabase stack or a separate test project** to verify:

- Fresh migration application and real Auth signup, including the signup trigger.
- PostgREST calls with real anonymous, user A, user B, and server credentials.
- Concurrent purchases against one wallet across different markets, concurrent duplicate request IDs, duplicate settlement calls, and a purchase racing settlement. Assert that balances reconcile with the ledger and credits remain unique.
- Repeated settlement and forced failures under the deployed PostgreSQL version and API timeouts.

PGlite serializes queries and does not prove multi-session concurrency behavior. The SQL locking design must also be exercised against full PostgreSQL.

The initial model is pre-match, whole-coin, fixed odds: winners receive 2x their stake, losers receive zero, and cancelled markets refund stakes. There is no cash value or conversion to money. Leaderboard scores include wallet balance plus unsettled stakes and intentionally expose user UUIDs and display names to signed-in users.
