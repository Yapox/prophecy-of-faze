# Preview upcoming FaZe CS2 matches

`scripts/fetch-faze-upcoming.cjs` is a standalone, read-only Node.js 20+ script. It needs no npm packages and does not connect to Supabase. Its only credential is the runtime environment variable `PANDASCORE_API_TOKEN`. Never put this token in React, a `VITE_` variable, source files, command-line arguments, or Git.

## API contract

Verified against PandaScore's official documentation:

- [Upcoming Counter-Strike matches](https://developers.pandascore.co/reference/get_csgo_matches_upcoming-1): `GET https://api.pandascore.co/csgo/matches/upcoming`. CS2 retains the `/csgo/` prefix.
- [Authentication](https://developers.pandascore.co/docs/authentication): `Authorization: Bearer <token>` is supported. The script uses this header, never a token query parameter, and refuses redirects.
- [Pagination](https://developers.pandascore.co/docs/pagination): `page[number]`, `page[size]` (maximum 100), and the response `Link` header. The script scans up to 50 pages and deduplicates matches by PandaScore match ID. A truncated scan is reported as an error, not a complete empty result.
- [Errors](https://developers.pandascore.co/docs/errors) and [rate limits](https://developers.pandascore.co/docs/rate-and-connections-limits): 401/403 fail with a safe message; 429 and server errors get at most two retries. The script honors `Retry-After` when present, but stops instead of automatically waiting longer than 30 seconds. Network requests time out after 15 seconds. Pagination stops if the reported remaining quota is zero.

Filtering uses exact team names `FaZe` and `FaZe Clan`, ignoring case and surrounding spaces. It inspects `opponents[].opponent`, not the match title, and excludes names such as `FaZe Academy`. It prints team IDs so a future importer can pin a verified provider ID rather than guessing one.

Each result shows the PandaScore match ID, UTC start date, opposing team, league, series, and tournament. Only `not_started` matches are included. A known date that is already past is excluded; an unannounced date or opponent is displayed as TBD. An empty result does not prove FaZe has no future fixtures: the provider's available schedule or naming may be incomplete. Pagination is not a transactional snapshot of a changing live schedule.

## Secure PowerShell invocation

Run this from the repository root only when ready to make API requests. The prompt hides the token; the command history contains variable names, not its value. The environment variable exists only for this shell/run and is removed in `finally`.

```powershell
$pandaTokenSecure = Read-Host 'PandaScore API token' -AsSecureString
$pandaTokenPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pandaTokenSecure)
try {
    $env:PANDASCORE_API_TOKEN = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pandaTokenPointer)
    node .\scripts\fetch-faze-upcoming.cjs
}
finally {
    Remove-Item Env:\PANDASCORE_API_TOKEN -ErrorAction SilentlyContinue
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pandaTokenPointer)
    $pandaTokenSecure.Dispose()
}
```

Do not use `setx`, paste a literal token into a command, print the environment variable, or save it in an `.env` file for this preview. Environment variables are plaintext in process memory; use your own trusted computer/session and avoid debug tracing or environment dumps.

To check syntax without loading the script or making a request:

```powershell
node --check .\scripts\fetch-faze-upcoming.cjs
```

## Existing Supabase schema and future mapping

The source of truth is [the existing migration](../supabase/migrations/20261114000000_initial_backend.sql). No schema change or import is part of this preview.

| `public.matches` column | Existing constraint/default | Possible future source |
|---|---|---|
| `id` | UUID primary key, generated automatically | Keep Supabase UUID; PandaScore integer is separate |
| `game` | Required text, trimmed length 1–100 | `CS2` |
| `event_name` | Required text, trimmed length 1–200 | Reviewed league/series/tournament description |
| `faze_team` | Required, defaults to and must equal `FaZe Clan` | Keep the canonical default |
| `opponent` | Required text, trimmed length 1–100; must not equal `faze clan` ignoring case/spaces | The other named team |
| `starts_at` | Required finite `timestamptz` | Valid `scheduled_at`, with `begin_at` fallback |
| `external_reference` | Nullable, unique text | Suggested namespaced value `pandascore:match:<id>` |
| `created_at` | Required `timestamptz`, defaults to `now()` | Database default |

The schema does not store PandaScore team IDs or separate league/tournament columns. Missing dates or unknown opponents must be reviewed before any future import; do not invent a start time. API strings also need validation against the column length limits. No prediction markets are created automatically by this script.
