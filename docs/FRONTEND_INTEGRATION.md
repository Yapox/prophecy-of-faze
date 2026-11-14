# Prophecy of FaZe: frontend integration for Ash

Subigya owns the Supabase backend; Ash owns the React frontend. This guide follows [the initial migration](../supabase/migrations/20261114000000_initial_backend.sql). The examples below are instructions for frontend integration; creating this guide does not create or change frontend source files.

The backend uses **virtual coins only**. There are no deposits, withdrawals, cash value, or redemption. A winning prediction returns 2x its stake, a losing prediction returns zero, and a cancelled market refunds the stake. This is a fixed-payout model, not an order book: selling positions and user-to-user transfers are not implemented.

Live checks reported by Subigya passed: signup initialized 1,000 coins; a 100-coin YES purchase left 900; an identical retry left 900; exactly one position and purchase transaction were created. Settlement and concurrent-request behavior still need their own integration tests.

## 1. Install the browser client

From Ash's Vite React application directory:

```powershell
npm.cmd install @supabase/supabase-js@2
```

On other shells, `npm install @supabase/supabase-js@2` is equivalent. No Supabase CLI or database password is needed to use the frontend client.

## 2. Configure Vite environment variables

Create a local `.env.local` in the Vite app root, alongside its `package.json`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

Replace these placeholders with the URL and **publishable** key for the `prophecy-of-faze` project. The real publishable key starts with `sb_publishable_`. Do not use a secret key, `service_role` key, database password, or personal access token.

All `VITE_` values are embedded in browser code. These two values are intended to be public; authorization comes from the user's Auth session and database permissions. Verify `.env.local` is ignored by Git before creating it. A committed `.env.example`, if Ash adds one, must contain placeholders only. Restart Vite after changing environment variables. Configure the same two public variables in the frontend hosting environment before building there.

Reference: [Vite environment variables](https://vite.dev/guide/env-and-mode).

## 3. Initialize one Supabase client

Suggested frontend module: `src/lib/supabase.js`.

```javascript
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey?.startsWith('sb_publishable_')) {
  throw new Error('Configure the Supabase URL and public publishable key.');
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
```

Import this singleton in API helpers and React components; do not construct a client on every render. The SDK manages the browser session and sends the signed-in user's access token with database/RPC calls. Do not manually copy tokens into environment variables or add a privileged Authorization header.

Reference: [Supabase client initialization](https://supabase.com/docs/reference/javascript/initializing).

## 4. Signup, login, and session state

The following helpers can live in a frontend API module. All later helper examples use the same imports and `requireUser()` helper.

```javascript
import { supabase } from './supabase';

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export async function logIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export async function logOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

export async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Authentication required');
  return data.user;
}
```

Obtain email/password from form inputs at runtime. Never hardcode, log, or store the password yourself. Clear password form state after submission. The SDK's managed browser session contains credentials, so protect the application against XSS and never log session objects.

If email confirmation is enabled, signup can return a user with `session === null`. Show a neutral "Check your email to continue" message and wait for a valid session before reading application tables. Configure the project's Site URL and allowed redirect URLs for Ash's actual frontend origin if using confirmation redirects.

The signup trigger creates the profile, wallet, and 1,000-coin bonus transaction automatically. **Do not insert any of those rows from React.** Profile display names initially default to `FaZe Fan`; passing Auth signup metadata does not change that column.

For React session state, subscribe once and clean up on unmount:

```javascript
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

export function useAuthSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setReady(true);
      },
    );
    return () => subscription.unsubscribe();
  }, []);

  return { session, ready };
}
```

The SDK emits `INITIAL_SESSION` when it has loaded the initial session. Keep the callback synchronous; fetch application data from a separate effect once `ready` and `session?.user.id` are available. Clear private UI/query caches on logout or account changes, and discard stale responses from a previous account. Session state is for UI rendering; RLS remains the authorization boundary.

References: [signup](https://supabase.com/docs/reference/javascript/auth-signup), [password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [Auth state events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

## 5. Fetch matches and prediction markets

These tables require a signed-in user, even though their rows are shared with all authenticated users. A publishable key alone does not grant read access.

```javascript
export async function getMatches() {
  const { data, error } = await supabase
    .from('matches')
    .select('id,game,event_name,faze_team,opponent,starts_at,external_reference,created_at')
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true })
    .range(0, 49);
  if (error) throw error;
  return data;
}

export async function getMarketsForMatch(matchId) {
  const { data, error } = await supabase
    .from('prediction_markets')
    .select('id,match_id,question,closes_at,status,winning_side,settled_at,created_at')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(0, 49);
  if (error) throw error;
  return data;
}
```

These examples return a first page of up to 50 rows; use subsequent ranges when needed. Timestamps are timezone-aware ISO strings. Format them for the viewer's timezone.

Market status values are exactly `open`, `resolved`, and `cancelled`. **`closed` is not a status.** An `open` market past `closes_at` cannot accept purchases and should appear as "Closed, awaiting result" in the UI. Disable purchasing when its closing time or the match start has passed. Browser time is only a display aid; the database checks its own clock.

Every match has `faze_team = 'FaZe Clan'`; `opponent` holds the other team. There are no `team_a`, `team_b`, `odds`, `price`, or `winner` columns. Outcome is stored in the market's `winning_side` (`YES`, `NO`, or null).

## 6. Fetch wallet, positions, and transaction history

```javascript
export async function getWallet() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from('wallets')
    .select('user_id,balance,updated_at')
    .eq('user_id', user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function getPositions(marketId) {
  const user = await requireUser();
  let query = supabase
    .from('prediction_positions')
    .select('id,user_id,market_id,side,stake,request_id,created_at')
    .eq('user_id', user.id);
  if (marketId) query = query.eq('market_id', marketId);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, 49);
  if (error) throw error;
  return data;
}

export async function getWalletHistory() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('id,user_id,position_id,kind,amount,balance_after,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, 49);
  if (error) throw error;
  return data;
}
```

RLS independently limits these reads to the current user; the explicit user filters make intent clear. A missing wallet is a backend/data error, not a reason to create a wallet or invent a default balance in React.

Positions are individual purchases: a user may have multiple rows, and may choose either side, in the same market. There is no position `status`, `payout`, or `settled_at` column. Fetch the associated market to display its outcome. History `kind` is one of `signup_bonus`, `prediction_purchase`, `prediction_payout`, and `prediction_refund`. Purchase amounts are negative; bonuses, payouts, and refunds are positive. Losing positions do not get an additional zero-value ledger entry.

## 7. Purchase a prediction and retry safely

Exact SQL signature:

```sql
public.purchase_prediction(
  p_market_id uuid,
  p_side public.prediction_side,
  p_stake bigint,
  p_request_id uuid
) returns public.prediction_positions
```

`p_side` is exactly `YES` or `NO`. `p_stake` is a whole number from **1 through 1,000,000,000**. There is no user-ID, price, payout, or balance argument. The function uses the authenticated user's ID and applies server-controlled coin rules.

Create one immutable intent for a deliberate purchase. Submit that same intent again for a retry:

```javascript
export async function createPurchaseIntent(marketId, side, stake) {
  if (!['YES', 'NO'].includes(side)) throw new Error('Choose YES or NO.');
  if (!Number.isSafeInteger(stake) || stake < 1 || stake > 1_000_000_000) {
    throw new Error('Enter a whole-coin stake from 1 to 1,000,000,000.');
  }
  const user = await requireUser();
  return Object.freeze({
    userId: user.id,
    args: Object.freeze({
      p_market_id: marketId,
      p_side: side,
      p_stake: stake,
      p_request_id: crypto.randomUUID(),
    }),
  });
}

export async function submitPurchase(intent) {
  const user = await requireUser();
  if (user.id !== intent.userId) {
    throw new Error('Account changed. Resolve the previous purchase before continuing.');
  }
  const { data, error } = await supabase.rpc('purchase_prediction', intent.args);
  if (error) throw error;

  // Normalize the composite return value to one position object.
  const position = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!position || Array.isArray(position) || !position.id
      || position.user_id !== user.id
      || position.request_id !== intent.args.p_request_id) {
    throw new Error('Purchase response could not be verified. Keep the same request ID.');
  }
  return position;
}
```

Example from an explicit submit event (not an effect or component render):

```javascript
// marketId is an actual UUID selected from prediction_markets.
// Store this intent in a React ref/state before sending the first request.
const intent = await createPurchaseIntent(marketId, 'YES', 100);
const position = await submitPurchase(intent);

// If the response is lost or the first attempt fails ambiguously:
// await submitPurchase(intent); // SAME intent, UUID, side, market, and stake
```

The unique key is `(user_id, request_id)`. Identical retries return the original position without a new debit, even if the market later closes or settles. Reusing the UUID with different parameters is rejected. A new UUID means a new purchase, even when the other fields match.

React handling requirements:

- Disable submit while a request is pending and use an immediate in-flight ref guard. Keep that guard around intent creation too, so a double-click cannot generate two UUIDs.
- Retain the original intent after a network timeout, connection loss, or unexpected response. The purchase may already be committed. Offer "Retry purchase" using the same intent; do not automatically create another UUID.
- If retry needs to survive a page reload, save only the pending intent (owner UUID plus RPC arguments) in per-user session storage before sending. Never store passwords or raw tokens there yourself. On account change, do not replay a previous user's intent.
- Once RPC success is confirmed, mark the purchase successful before refreshing other data. A failed follow-up wallet fetch does not mean the purchase failed.
- Refetch the wallet, positions, wallet history, and leaderboard after success. Treat refresh errors separately; never debit the wallet locally a second time on retry.
- Reconcile an uncertain outcome by querying the user's positions with `.eq('request_id', intent.args.p_request_id)` or retrying the exact RPC. Keep the intent until the outcome is known.

With an untouched wallet, a 100-coin purchase produces balance 900, one position with `stake = 100`, and one ledger row with `kind = 'prediction_purchase'`, `amount = -100`, and `balance_after = 900`. An identical retry must preserve those results.

`crypto.randomUUID()` requires a secure browser context (HTTPS or localhost). Do not replace it with `Math.random()` or a timestamp. Reference: [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc).

## 8. Fetch the leaderboard

There is **no `leaderboard` table or view**. Use the authenticated RPC:

```sql
public.get_leaderboard(p_limit integer default 100)
returns table (
  rank bigint,
  user_id uuid,
  display_name text,
  total_coins bigint
)
```

```javascript
export async function getLeaderboard() {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: 50 });
  if (error) throw error;
  return data;
}
```

The server clamps the limit to 1–100; null uses 100. `total_coins` equals wallet balance **plus stakes in all unsettled (`open`) markets**, including markets past their closing time. This means the example 100-coin purchase leaves wallet balance 900 but leaderboard score 1,000 until settlement. Ties share a dense rank; UUID provides deterministic ordering within ties. UUIDs, display names, ranks, and scores are intentionally shared with authenticated users. Other users' wallet rows and position history remain private.

To update the current user's leaderboard display name, the only permitted profile edit is:

```javascript
export async function updateDisplayName(displayName) {
  const user = await requireUser();
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName.trim() })
    .eq('id', user.id)
    .select('id,display_name,created_at')
    .single();
  if (error) throw error;
  return data;
}
```

The database requires the trimmed name to contain 1–50 characters.

## 9. Security and error handling

### Allowed browser operations

| Resource | Authenticated browser access |
|---|---|
| `profiles` | Read own row; update own `display_name` only |
| `wallets` | Read own row only |
| `matches` | Read shared rows only |
| `prediction_markets` | Read shared rows only |
| `prediction_positions` | Read own rows only |
| `wallet_transactions` | Read own rows only |
| `purchase_prediction(...)` | Execute as current user |
| `get_leaderboard(integer)` | Execute; receives the limited shared projection |

All six tables have RLS enabled. Unauthenticated clients have no table reads or RPC execution rights. Showing a login page or disabling a button improves the UX but does not replace these database controls.

Do not insert positions, edit balances, insert transactions, create matches/markets, or calculate authoritative payouts in React. The purchase RPC atomically checks funds, deducts coins, creates the position, and records its ledger debit. Settlement is exclusively a trusted-backend operation:

```sql
-- Signature reference only. NEVER call from the frontend.
public.settle_prediction_market(
  p_market_id uuid,
  p_winning_side public.prediction_side
) returns void
```

Only `service_role` may execute settlement. YES/NO resolves a market; null cancels and refunds. Privileged credentials must stay on the backend. The initialization and market-window trigger functions are not frontend RPCs.

### Handle failures without exposing credentials

Helpers above throw errors for callers to catch. Supabase normally returns `{ data, error }`; ignoring `error` can falsely show success. Convert errors to a small set of UI messages instead of displaying arbitrary server responses or logging full Auth/session/request objects.

Exact purchase business errors currently raised by the migration:

| Database message | UI action |
|---|---|
| `Authentication required` | Ask the user to sign in |
| `Valid market, side, whole-coin stake and request ID required` | Correct form values before creating a new intent |
| `Market not found` | Refresh available markets |
| `Wallet not found` | Show an account setup error; contact Subigya |
| `Request ID already used with different purchase parameters` | Stop; reconcile the original intent rather than silently replacing the UUID |
| `Market is closed` | Disable purchasing and refresh the market |
| `Match has already started` | Disable purchasing and refresh the match |
| `Insufficient virtual coins` | Refresh the balance and ask for a smaller stake |

These business exceptions use PostgreSQL code `P0001`. Match only known messages; use a generic fallback for unknown errors. Permission code `42501` indicates a blocked operation or missing authorization; do not retry it with elevated credentials. Auth errors such as `invalid_credentials` and `email_not_confirmed` need sign-in/confirmation UI. A missing `.single()` row may surface as `PGRST116`; never respond by inserting a wallet from the browser.

Example presentation helper:

```javascript
export function purchaseErrorMessage(error) {
  if (error?.code === 'P0001') {
    const messages = {
      'Authentication required': 'Please sign in to continue.',
      'Insufficient virtual coins': 'You do not have enough virtual coins.',
      'Market is closed': 'This market is closed.',
      'Match has already started': 'Predictions have closed for this match.',
      'Market not found': 'This market is unavailable. Refresh the list.',
      'Wallet not found': 'Your wallet is unavailable. Contact the team.',
      'Request ID already used with different purchase parameters':
        'This request belongs to a different purchase. Check its status first.',
      'Valid market, side, whole-coin stake and request ID required':
        'Check the selected market, side, and whole-coin stake.',
    };
    if (messages[error.message]) return messages[error.message];
  }
  if (error?.code === '42501') return 'This action is not permitted. Check your sign-in.';
  return 'We could not confirm the purchase. Check its status or retry the same request.';
}
```

Show loading, empty, and error states separately. Use a read-only retry for failed fetches. For ambiguous purchase failures, preserve the original request ID and arguments. Never print passwords, access tokens, refresh tokens, or privileged keys to the console, analytics, or error trackers.

Coin balances, ledger amounts, stakes, leaderboard scores, and ranks use PostgreSQL `bigint`. The allowed stake fits safely in a JavaScript number. For accumulated balances and scores, do not perform arithmetic on unsafe JSON numbers: check `Number.isSafeInteger` before using a number. If values can exceed JavaScript's safe integer range, ask Subigya for an API representation that serializes them as decimal strings before implementing exact arithmetic. Converting an already-rounded JSON number to `BigInt` cannot recover its precision.

This migration does not configure Supabase Realtime publications. Refetch after a successful mutation and on relevant screen focus; do not assume subscriptions are available.

## Frontend handoff checklist

- Configure only the project URL and publishable key; sign in as a real test user.
- Handle confirmation-required signup without attempting private reads before login.
- Verify matches/markets load after authentication and private caches clear on logout.
- Display whole virtual coins, YES/NO choices, and market closing times.
- Verify a fresh test user's 100-coin purchase yields 900 and one position/debit.
- Verify retrying the same intent leaves the same position and balance.
- Verify wallet refresh failures do not offer a new purchase as a retry.
- Show the leaderboard through `get_leaderboard`, with unsettled stake included in scores.
- Do not reset the already-tested 900-coin wallet to 1,000 or modify migrations to repeat a test; coordinate a separate test account with Subigya when a fresh baseline is required.
