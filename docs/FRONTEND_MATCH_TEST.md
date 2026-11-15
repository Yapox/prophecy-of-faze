# Frontend verification for PandaScore matches

The frontend branch includes GitHub main through `3eaf40e`, including Subigya's PandaScore importer, market setup, settlement preparation, and scheduled result-check workflow. That workflow uses dry-run mode; it does not apply settlements. His message reports two matches and markets in the deployed database. Their live contents have not yet been independently verified by this frontend session.

## Checks completed

`npm run check:account` exercises the real React account-mode components and API helpers with controlled Supabase responses. Opponent/question strings match `scripts/sql/create-pandascore-prediction-markets.sql`:

- FaZe Clan vs fnatic: `Will FaZe Clan beat fnatic?`
- FaZe Clan vs Wildcard: `Will FaZe Clan beat Wildcard?`

The test uses synthetic UUIDs, times, event names, account identity, and balances. It does not claim to have read the deployed records or completed live purchases.

The account DOM test verifies both cards, questions, enabled trading controls for future open markets, a 100-coin YES purchase, recovery from a lost purchase response using the original request ID, a 100-coin NO purchase, wallet and portfolio refresh, leaderboard score including unsettled stakes, and clearing private data on logout. Controlled balances progress from 1,000 to 900 to 800 without a second debit on retry.

A display regression was found and fixed: unknown opponents inherited the sample NAVI monogram. Opponents now use their own initial, including F for fnatic and W for Wildcard. The match query also reads `external_reference`; imported records receive a `PandaScore import` label, while practice records remain labeled `Sample fixture`.

The practice DOM regression and production build also pass.

## Live refresh behavior

Configured projects now open account mode, ignoring the old saved practice-mode preference. Signed-out account mode shows a sign-in prompt and no seeded cards. Practice remains available through an explicit button; its wallet and positions remain separate.

After sign-in, account records refresh every 30 seconds while the tab is visible, on focus, on becoming visible, on reconnect, and after a purchase. Successful refreshes display a last-sync time. Logout clears private data and removes the refresh timer/listeners. Errors preserve already-loaded records and offer a retry.

The controlled account test verifies the old practice preference cannot hide account mode, no protected reads happen before login, hidden tabs do not poll, and focus/poll/reconnect refreshes fetch updated records. It also adds a synthetic backend fixture after initial load and supplies a synthetic settlement to verify the new card, resolved position, and updated wallet appear without reloading. These checks do not execute a live import or settlement.

## Live check and remaining steps

Reading the two target references with only the configured public key returned HTTP 401. This is consistent with the backend requiring an authenticated user; it is not evidence that rows are missing. No live match or wallet data was changed.

After fetching `b4d38bc`, read-only requests to both `matches` and `prediction_markets` with the configured public key again returned HTTP 401. An authenticated session is still required; no privileged key is used by the frontend.

Use an email-confirmed test account in account mode at the local preview. Verify:

1. Both real records display their database opponents, event context, start times, and prediction questions.
2. A future open market allows a YES or NO selection and shows 100 virtual coins as the cost and 200 as the possible return for 100 contracts.
3. One deliberate purchase subtracts 100 from the existing balance, adds one position, and adds one purchase ledger entry. Do not reset an existing wallet to 1,000.
4. A pending-request retry, if offered, confirms the same purchase without a new debit. A new purchase intent is a separate trade.
5. Reloading preserves the account session and backend balance. Leaderboard score includes unsettled stakes.

Account settlement remains a trusted-backend action. Coordinate any payout check with Subigya; do not resolve or alter real markets from the browser. The cinematic landing update has since added real headless Chromium desktop/mobile inspection and practice-purchase testing, documented in `CINEMATIC_LANDING.md`. Authenticated deployed-data requests remain pending because an email-confirmed test session is unavailable here.
