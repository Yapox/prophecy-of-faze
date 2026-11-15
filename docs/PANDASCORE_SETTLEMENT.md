# PandaScore settlement preparation

This is a server-side Node.js 20+ tool for Prophecy of FaZe. The script defaults to a **GET-only dry-run**; `--apply` is a separate write mode. The repository now includes an optional automation migration and a scheduled workflow with an explicit apply control. Those require deployment/activation as described in [DEPLOYMENT.md](DEPLOYMENT.md). No live settlement was performed during implementation.

## Feasibility on Fixtures Only

PandaScore's [overview](https://developers.pandascore.co/docs/introduction) includes match scores and winners in Fixtures Only. Its [plan reference](https://developers.pandascore.co/docs/plan-reference) lists `GET /csgo/matches/past` for all plans, including Free/Fixtures. The [past CS matches endpoint](https://developers.pandascore.co/reference/get_csgo_matches_past-1) is therefore the result source used here.

The same plan reference lists single-match `GET /csgo/matches/{id}` and per-game/statistics endpoints under Historical. This tool does not call them. It filters the **past-match list** by the numeric IDs taken from our database references, using batches of at most 50 IDs and paginated results. Unknown or conflicting returned IDs stop the scan safely.

This establishes documented feasibility, not a live entitlement check for your token. Missing fields or a 403 response cause a skip/failure, never a guessed winner. A first read-only run against a finished imported fixture is still needed to confirm your account's returned fields.

References for result semantics: [match lifecycle](https://developers.pandascore.co/docs/matches-lifecycle), [filtering](https://developers.pandascore.co/docs/filtering-and-sorting), [pagination](https://developers.pandascore.co/docs/pagination), [authentication](https://developers.pandascore.co/docs/authentication).

## Existing database contract

Source: [initial migration](../supabase/migrations/20261114000000_initial_backend.sql).

- `matches.external_reference` is unique. Only exact `pandascore:match:<positive integer>` references are considered.
- The importer identifies FaZe by exact names when inserting matches. Settlement adds the stricter, user-supplied PandaScore FaZe team ID **3212** and requires it to appear exactly once among two distinct team participants.
- The database stores opponent names, not provider team IDs. The live result's opposing team name must also match the stored opponent. This is a conservative cross-check, not a stored opponent-ID mapping.
- Only the exact question `Will FaZe Clan beat <stored opponent>?` is supported. Match results cannot settle first-map, score, round, or other question types.
- Only `open` markets with null winning side/timestamp and a passed, valid cutoff are eligible. Multiple open markets for the same match require manual review.

The only permitted write endpoint in the script is:

```sql
public.settle_prediction_market(
  p_market_id uuid,
  p_winning_side public.prediction_side
) returns void
```

Its request body contains exactly `p_market_id` and `p_winning_side`. The latter is `YES` when the declared winner ID is 3212 and `NO` when the declared winner is the other confirmed participant. No null/cancellation/refund calls are generated. No table INSERT, UPDATE, or DELETE is sent by this tool.

The RPC handles atomic wallet updates and ledger credits. Its market lock serializes settlements, an identical resolved outcome returns without another payout, conflicting outcomes raise an error, and `one_credit_per_position` prevents duplicate payout/refund credits. The script does not duplicate that wallet logic in JavaScript.

## Conservative eligibility rules

Every proposed settlement requires all of the following:

1. A valid imported CS2 database match and its linked market. Fictional/test labels, non-PandaScore references, and the original fictional market UUID are excluded.
2. An exact supported question, an already-closed market, a past start, and market creation before its cutoff and the actual match start.
3. A provider record whose ID matches the external reference and whose status is exactly `finished`.
4. Explicit `draw = false` and `forfeit = false`; rescheduled matches are deferred for review. Canceled and postponed records are always excluded, even if they carry a winner ID.
5. Valid scheduled, actual start, end, and modification timestamps. The provider schedule must equal the stored match start, and the match must have begun after prediction closure.
6. At least 15 minutes since both the reported end and latest modification. This is an application grace period, **not a provider finality guarantee**.
7. Exactly two distinct team IDs, including 3212, with consistent names. A valid `winner_id` must belong to those participants; any supplied winner object/type must agree.
8. Exactly two nonnegative integer team scores associated with those IDs, with the declared winner strictly ahead. A score alone never selects a winner.

PandaScore's `complete` field concerns detailed post-game statistics and may not appear in the Fixtures payload. The script does not require an absent field or request paid statistics. If `complete` is explicitly supplied and is not true, the record is deferred. Missing identity, timing, score, or draw/forfeit fields are also deferred.

Default dry-run prints only reviewed RPC proposals and constant skip reasons. Applying later re-fetches the selected market and provider evidence before each RPC and requires the same eligible proposal. It stops on drift or errors. It never alters closing times or forces an outcome.

## Risks and limits before automatic operation

- **Provider corrections:** payout idempotency prevents paying twice; it does not make a wrong first payout correct. The RPC cannot reverse a committed outcome. This tool reads open markets, so it does not monitor corrections to already-settled markets. Conflicting corrections need manual handling.
- **Provenance:** the original RPC does not store provider evidence. With the new migration and `PANDASCORE_AUDIT=true`, the script calls `settle_pandascore_prediction` with its validated evidence and stores the first settlement receipt atomically. The scheduled workflow selects this audited mode. Existing historical settlements are not retroactively reconstructed.
- **Reschedules:** the current importer does not update existing match dates. Schedule drift and explicit reschedules are intentionally skipped; review the market's original betting window before resolving them.
- **Special outcomes:** forfeits, draws, cancellation, and ambiguous data require a defined manual policy. This script does not automatically cancel or refund.
- **Read/write races:** external API reads and the RPC are not one transaction. Revalidation narrows that gap; the existing RPC protects status and payout concurrency. Do not concurrently edit market identity/question/schedule through privileged tools. An RPC-side evidence/identity guard would require separately reviewed backend changes.
- **Partial batches:** each RPC commits independently. If a later call fails or its response is lost, earlier markets may already be settled. Inspect state and rerun a dry-run before proceeding. No automatic POST retry is performed.
- **Availability:** bounded page limits, unexpected payloads, quota exhaustion, or missing results cause deferral/failure, not a guessed NO outcome. Pagination of changing data can defer a market to a later run.

Review initial dry-run proposals before setting `PANDASCORE_SETTLEMENT_ENABLED=true`. The workflow defaults to dry-run; its apply mode requires the new migration. Ambiguous or special outcomes are still deferred to review.

## Credentials and secure dry-run

Unlike the match-import dry-run, this dry-run needs private database reads as well as PandaScore reads. Set:

- `PANDASCORE_API_TOKEN`
- `SUPABASE_URL`
- Exactly one of `SUPABASE_SECRET_KEY` (preferred `sb_secret_...`) or legacy `SUPABASE_SERVICE_ROLE_KEY`

Publishable/anon/user credentials are rejected. Server keys bypass RLS and must never reach React, `VITE_` variables, source control, or client logs. The script uses the importer's existing key validation and native HTTP: new secret keys use `apikey`, while legacy JWT keys also use the Bearer header. PandaScore has its own Bearer header, never a URL token. Redirects are refused.

Use the hidden-prompt `Set-SessionSecret` helper in [PANDASCORE_IMPORT.md](PANDASCORE_IMPORT.md), then run from the repository root only when ready for read-only live requests:

```powershell
try {
    $env:SUPABASE_URL = Read-Host 'Supabase project URL'
    Set-SessionSecret SUPABASE_SECRET_KEY
    Set-SessionSecret PANDASCORE_API_TOKEN
    node .\scripts\settle-pandascore-markets.cjs --dry-run
}
finally {
    Remove-Item Env:\SUPABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\PANDASCORE_API_TOKEN -ErrorAction SilentlyContinue
}
```

If using the legacy key, substitute its variable name in the prompt and cleanup; do not set both key variables. No token/key is saved in a file. For unattended future operation, use an OS-backed or hosting secret manager to inject process-local environment variables. Avoid environment dumps, HTTP debug traces, shared untrusted terminals, and literal credentials in shell commands.

`--apply` exists for a later controlled execution. It is never implicit. It sends only eligible proposals to the RPC after fresh checks. The preparation and tests do not execute that mode against live services or invoke real settlements.

## Offline checks

No packages or API credentials are needed:

```powershell
node --check .\scripts\settle-pandascore-markets.cjs
node --test .\scripts\tests\settle-pandascore-markets.test.cjs
```

The tests globally forbid real network access and inject synthetic API/database responses. They check YES/NO selection, exact market UUID routing, wrong/missing/contradictory winners, canceled/postponed/unfinished records, fictional exclusion, unrelated questions, the exact 15-minute boundary, modified-result delay resets, changed results, repeat-run dispatch, rate limits, credential redaction, and RPC failure handling.

Mocked apply-path tests record intended HTTP calls and model synthetic wallet/ledger state in memory, including a committed settlement whose response is lost. They execute no SQL, real wallet updates, or real settlement RPCs. A passing mock demonstrates the script's control flow under an idempotent RPC contract; it does not prove PostgreSQL locks, atomicity, unique constraints, or actual concurrent-request behavior. Those protections still need controlled full-stack testing with the deployed migration, preferably in an isolated test project rather than against real-user balances.
