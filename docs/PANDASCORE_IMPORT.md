# Insert-only PandaScore match importer

This page describes the original match-only CLI. For atomic match **and market** publication, scheduled jobs, and reschedule handling, use `sync-pandascore-markets.cjs` and the migration/activation steps in [DEPLOYMENT.md](DEPLOYMENT.md). The original importer below remains insert-only.

Run `scripts/import-pandascore-matches.cjs` from a trusted server-side Node.js 20+ environment. It uses native `fetch`; no npm packages, browser client, Supabase Auth login, or database password is needed. This guide does not authorize or perform a live import.

## Modes

```powershell
# Default mode: fetch PandaScore and print proposed match inserts.
node .\scripts\import-pandascore-matches.cjs --dry-run

# Equivalent default:
node .\scripts\import-pandascore-matches.cjs

# Writes only when explicitly requested; review the dry-run first.
node .\scripts\import-pandascore-matches.cjs --apply
```

Dry-run needs **only `PANDASCORE_API_TOKEN`**. It makes PandaScore requests but makes **no Supabase requests**, even if Supabase credentials happen to be present. It is a preview of valid candidates, not a database diff; it cannot know which references already exist.

Apply additionally needs `SUPABASE_URL` and exactly one of:

- `SUPABASE_SECRET_KEY`: a server-only `sb_secret_...` key (preferred).
- `SUPABASE_SERVICE_ROLE_KEY`: the legacy service-role JWT, if using the old key system.

Publishable keys, legacy anon keys, and user JWTs are rejected for writes. JWT payload inspection is only a local misuse check; the Supabase gateway verifies actual credentials. Secret keys use the `apikey` header; legacy service-role keys also use `Authorization: Bearer`. No user session is attached.

## Mapping to the existing schema

The importer follows [the initial migration](../supabase/migrations/20261114000000_initial_backend.sql) and sends only its five permitted service-role insert columns:

| `public.matches` column | Value |
|---|---|
| `game` | `CS2` |
| `event_name` | Nonempty league, series, and tournament names joined with ` / `; repeated names removed |
| `opponent` | The other named team |
| `starts_at` | Future, validated timezone-qualified ISO timestamp; uses `scheduled_at`, or `begin_at` only when the schedule is absent |
| `external_reference` | `pandascore:match:<positive integer match ID>` |

The database generates `id` and `created_at` and supplies `faze_team = 'FaZe Clan'`. The service role does not have insert grants for those three columns, so the importer omits them.

The two fixtures reported from the successful preview would have references `pandascore:match:1796528` and `pandascore:match:1789256`. They are **not hardcoded**: the importer fetches the current schedule each time, so dates, participants, or availability may change. Its `event_name` includes event context rather than guaranteeing a verbatim copy of one PandaScore field.

Only exact `FaZe` / `FaZe Clan` team names are accepted (case and outer spaces ignored). Candidates must have exactly two identified team objects, exactly one FaZe participant, and status `not_started`. The importer skips absent/placeholder opponents, invalid IDs, invalid or nonfuture dates, invalid control characters, and names that exceed the existing 100-character opponent or 200-character event constraints. It rejects invalid schedules instead of inventing dates or silently truncating names.

## Duplicate and fictional-fixture protection

Apply uses one bulk POST to `public.matches` with `on_conflict=external_reference` and `Prefer: resolution=ignore-duplicates`. This implements **INSERT ... ON CONFLICT DO NOTHING**, not an update/merge. It never uses PATCH or DELETE, never finds records by opponent/date, and never sends existing UUIDs.

The existing unique constraint enforces deduplication, including concurrent importer runs. Every existing row is left unchanged, even if a conflicting reference belongs to a fictional fixture. Existing PandaScore rows also remain unchanged if the upstream schedule changes; reschedule/update synchronization is intentionally not implemented. No prediction market is created.

Pagination must complete before any Supabase write. Shared PandaScore fetching comes from `fetch-faze-upcoming.cjs`, retaining its Bearer-header authentication, request timeouts, page cap, quota checks, and bounded network/429/5xx retries. A failed/incomplete scan aborts the import. Output is restricted to validated proposals and safe errors; credentials and raw error bodies are never printed.

The bulk insert is one database statement. A database constraint failure aborts that statement. A network timeout can still occur after the server committed: inspect the database, then rerun if appropriate using the same external references. Conflict-ignore makes that rerun duplicate-safe. No automatic Supabase write retry occurs. The success message reports submitted candidates, not an exact inserted-versus-already-existing count.

## Secure local dry-run in PowerShell

From the repository root, define this helper in your terminal. It prompts without echo and sets only a process-local environment variable. It does not save the secret or put it in shell history.

```powershell
function Set-SessionSecret {
    param(
        [ValidateSet('PANDASCORE_API_TOKEN', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')]
        [string]$Name
    )
    $importSecret = Read-Host $Name -AsSecureString
    $importSecretPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($importSecret)
    try {
        [Environment]::SetEnvironmentVariable(
            $Name,
            [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($importSecretPointer),
            'Process'
        )
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($importSecretPointer)
        $importSecret.Dispose()
    }
}

try {
    Set-SessionSecret PANDASCORE_API_TOKEN
    node .\scripts\import-pandascore-matches.cjs --dry-run
}
finally {
    Remove-Item Env:\PANDASCORE_API_TOKEN -ErrorAction SilentlyContinue
}
```

Review proposed rows, references, event names, opponents, and UTC start times. A missing fixture may have started, been rescheduled, or lack sufficient provider data. Skipped records include reasons. Dry-run does not validate Supabase credentials, project access, or existing database contents.

## Apply later, only after reviewing the preview

Use the helper above in a trusted terminal. Supply the URL of the intended Supabase project, and use its server secret key rather than any frontend variable:

```powershell
try {
    $env:SUPABASE_URL = Read-Host 'Supabase project URL (https://PROJECT_REF.supabase.co)'
    Set-SessionSecret PANDASCORE_API_TOKEN
    Set-SessionSecret SUPABASE_SECRET_KEY
    node .\scripts\import-pandascore-matches.cjs --apply
}
finally {
    Remove-Item Env:\PANDASCORE_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:\SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\SUPABASE_URL -ErrorAction SilentlyContinue
}
```

If using the legacy key instead, substitute `SUPABASE_SERVICE_ROLE_KEY` in both the prompt and cleanup. Set exactly one server key variable; remove stale key variables before applying. The script prints the target project URL before fetching or writing. Apply fetches fresh data, so it can differ from an earlier dry-run; this is not a saved-plan replay.

For ongoing jobs, keep keys in an OS-backed credential vault or the hosting platform's encrypted secret manager and inject them into this backend process at runtime. Prefer a separate rotatable server secret key for the importer. Process environment variables are plaintext in memory, so do not dump the environment, enable HTTP/header debug tracing, or run on an untrusted shared computer. Never use `VITE_` variables, `setx`, committed configuration, or pasted literal keys in commands. This importer does not load `.env` files and needs no credential files in Git.

## Verification performed during preparation

Syntax checks only are safe without credentials:

```powershell
node --check .\scripts\import-pandascore-matches.cjs
node --check .\scripts\fetch-faze-upcoming.cjs
```

The importer has not been run against PandaScore or Supabase during preparation. Its credential, REST, and schema compatibility still need a reviewed dry-run and subsequent controlled integration test.

References: [PandaScore upcoming CS matches](https://developers.pandascore.co/reference/get_csgo_matches_upcoming-1), [PandaScore authentication](https://developers.pandascore.co/docs/authentication), [Supabase server API keys](https://supabase.com/docs/guides/getting-started/api-keys), [PostgREST conflict-ignore inserts](https://docs.postgrest.org/en/stable/references/api/tables_views.html#upsert).
