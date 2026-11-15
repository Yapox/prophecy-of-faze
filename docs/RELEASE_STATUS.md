# Remaining-work implementation status

| Area | Implementation | Deployment / live verification |
| --- | --- | --- |
| Landing, markets, trading, portfolio | Implemented | GitHub Pages published; desktop/mobile practice flow verified. |
| Signup and login | Implemented | Public Supabase connection configured; confirmed-account end-to-end test pending. |
| Password recovery | Implemented | Controlled form/event tests pass; email delivery and redirect allowlist need live verification. |
| Prediction streaks and daily goals | Implemented from prediction records, using UTC | No bonus-currency writes or new account permissions. |
| Oracle chat | Implemented, including separate HTTPS endpoint support | Gemini key and server host are not available in this workspace. Pages displays an unavailable notice until configured. |
| Recent performance context | Validated, sourced PandaScore result samples | Requires server provider token. No verified player statistics or full historical coverage claimed. |
| Automated fixtures and questions | Atomic RPC, scheduler and CLI implemented | New migration and explicit apply control need deployment. Default remains dry-run. |
| Automated payouts | Existing validation plus audited payout wrapper | Migration and apply control pending. Special outcomes require operator review. |
| Oracle request limits | In-process limit and optional database-backed quota | Durable quota requires the migration and server setting. |
| Legal pages | Updated for actual hosting, result samples, activity and operations | Operator/contact/eligibility/retention/request procedures still require actual information and review. |
| Variable exchange prices | Not implemented | Existing fixed 1-coin/2-coin contract remains the backend contract. Awaiting scope decision. |

Tests with controlled responses and the isolated SQL engine do not establish that live signup, trades, payouts or provider responses succeeded. See `DEPLOYMENT.md` for the concrete activation steps.
