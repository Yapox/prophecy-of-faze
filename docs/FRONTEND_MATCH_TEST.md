# Frontend verification for PandaScore matches

The frontend branch includes GitHub main through `a873fdb`, including Subigya's PandaScore importer and prediction-market setup. His message reports two matches and markets in the deployed database. Their live contents have not yet been independently verified by this frontend session.

## Checks completed

`npm run check:account` exercises the real React account-mode components and API helpers with controlled Supabase responses. Opponent/question strings match `scripts/sql/create-pandascore-prediction-markets.sql`:

- FaZe Clan vs fnatic: `Will FaZe Clan beat fnatic?`
- FaZe Clan vs Wildcard: `Will FaZe Clan beat Wildcard?`

The test uses synthetic UUIDs, times, event names, account identity, and balances. It does not claim to have read the deployed records or completed live purchases.

The account DOM test verifies both cards, questions, enabled trading controls for future open markets, a 100-coin YES purchase, recovery from a lost purchase response using the original request ID, a 100-coin NO purchase, wallet and portfolio refresh, leaderboard score including unsettled stakes, and clearing private data on logout. Controlled balances progress from 1,000 to 900 to 800 without a second debit on retry.

A display regression was found and fixed: unknown opponents inherited the sample NAVI monogram. Opponents now use their own initial, including F for fnatic and W for Wildcard. The match query also reads `external_reference`; imported records receive a `PandaScore import` label, while practice records remain labeled `Sample fixture`.

The practice DOM regression and production build also pass.

## Live check and remaining steps

Reading the two target references with only the configured public key returned HTTP 401. This is consistent with the backend requiring an authenticated user; it is not evidence that rows are missing. No live match or wallet data was changed.

Use an email-confirmed test account in account mode at the local preview. Verify:

1. Both real records display their database opponents, event context, start times, and prediction questions.
2. A future open market allows a YES or NO selection and shows 100 virtual coins as the cost and 200 as the possible return for 100 contracts.
3. One deliberate purchase subtracts 100 from the existing balance, adds one position, and adds one purchase ledger entry. Do not reset an existing wallet to 1,000.
4. A pending-request retry, if offered, confirms the same purchase without a new debit. A new purchase intent is a separate trade.
5. Reloading preserves the account session and backend balance. Leaderboard score includes unsettled stakes.

Account settlement remains a trusted-backend action. Coordinate any payout check with Subigya; do not resolve or alter real markets from the browser. Desktop/mobile visual inspection and live signed-in requests are still pending because browser automation and an authenticated test session are unavailable here.
