# Remaining-work implementation status

| Area | Implementation | Deployment / live verification |
| --- | --- | --- |
| Landing, markets, trading, portfolio | Implemented | GitHub Pages published; both real FaZe questions, live YES/NO purchases, wallet debits, duplicate protection, history and leaderboard verified. |
| Signup and login | Implemented | Temporary admin-confirmed account received exactly 1,000 coins; browser login, session persistence and logout passed. Public signup email delivery remains unverified. |
| Password recovery | Implemented | Controlled form/event tests pass; email delivery and redirect allowlist need live verification. |
| Prediction streaks and daily goals | Implemented from prediction records, using UTC | No bonus-currency writes or new account permissions. |
| Oracle chat | Supabase Edge Function and shared Node handler implemented; Deno check and controlled chat tests pass | Supabase deployment login and private Gemini secret are pending. Pages endpoint activation and a real signed-in Gemini reply remain unverified. |
| Recent performance context | Validated, sourced PandaScore result samples | Live provider read succeeded; the bounded 200-fixture sample contained no qualifying FaZe/fnatic results. No player statistics or full historical coverage claimed. |
| Automated fixtures and questions | Atomic RPC, scheduler and CLI implemented | Read-only schema check confirmed the new functions/ledger are absent. Dry-run found the two real upcoming fixtures. Apply remains disabled. |
| Automated payouts | Existing validation plus audited payout wrapper | Migration and apply control pending. Special outcomes require operator review. |
| Oracle request limits | In-process limit and optional database-backed quota | Durable quota requires the migration and server setting. |
| Footer and creator credits | Copyright 2026 Aashaswa Khakurel and Subigya Poudel; built for HackUTA 2026 | Terms and Privacy pages removed at the project owner's request. |
| Variable exchange prices | Not implemented | Existing fixed 1-coin/2-coin contract remains the backend contract. Awaiting scope decision. |

## Verified on the published site

The [live account workflow](https://github.com/Yapox/prophecy-of-faze/actions/runs/43674884186) passed on 2026-11-15 at 04:01 UTC (November 14 in Chicago). Its [sanitized report](verification/live-account-20261115.json) records the tested commit and results:

- FaZe vs fnatic and FaZe vs Wildcard prediction questions displayed from Supabase.
- Five-coin YES and NO purchases changed the wallet from 1,000 to 995 to 990. Retrying each exact request did not debit again.
- Transaction history, leaderboard membership, session persistence and logout passed.
- The tagged temporary account and its associated data were removed after testing.

Published recovery and activity UI checks passed at 320, 390 and 1440 pixels with no overflow, missing assets or browser exceptions. Actual signup/recovery email delivery and real-match settlement were not tested.

The [read-only migration check](https://github.com/Yapox/prophecy-of-faze/actions/runs/43675296657) at 04:06 UTC found neither automation RPC nor the operations ledger. Scheduled sync and settlement are still dry-run. Gemini hosting/key remains outstanding. See [DEPLOYMENT.md](DEPLOYMENT.md) for activation steps.
