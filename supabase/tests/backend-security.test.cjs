// Local, in-memory PostgreSQL only. No connection strings or cloud access.
// node supabase/tests/backend-security.test.cjs [path-to-@electric-sql/pglite]
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const alice = '00000000-0000-0000-0000-000000000001';
const bob = '00000000-0000-0000-0000-000000000002';
const request = '10000000-0000-0000-0000-000000000001';
const bobRequest = '10000000-0000-0000-0000-000000000002';
let checks = 0;

async function main() {
  const db = new PGlite();
  try {
    // Minimal Auth contract, with deliberately broad Supabase-like defaults.
    // This is not a substitute for integration tests on a full Supabase stack.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create role supabase_auth_admin nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      grant usage on schema auth to supabase_auth_admin;
      grant insert on auth.users to supabase_auth_admin;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      insert into auth.users values ('${alice}');
    `);
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261114000000_initial_backend.sql'), 'utf8');
    await db.exec(migration);

    async function as(role, user, sql, params = []) {
      await db.exec('begin');
      try {
        await db.exec(`set local role ${role}`);
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user || '']);
        const result = await db.query(sql, params);
        await db.exec('commit');
        return result.rows;
      } catch (error) {
        await db.exec('rollback');
        throw error;
      }
    }
    async function rejected(fn, pattern) {
      await assert.rejects(fn, pattern);
      checks++;
    }
    function equal(actual, expected) {
      assert.deepEqual(actual, expected);
      checks++;
    }
    async function balance(user) {
      return Number((await as('authenticated', user, 'select balance from public.wallets'))[0].balance);
    }
    async function buy(user, market, side, stake, id) {
      return as('authenticated', user, 'select * from public.purchase_prediction($1, $2, $3, $4)', [market, side, stake, id]);
    }
    async function settle(market, side) {
      return as('service_role', null, 'select public.settle_prediction_market($1, $2)', [market, side]);
    }
    const match = (await as('service_role', null, `insert into public.matches
      (game, event_name, opponent, starts_at) values ('CS2', 'Test event', 'Opponent', now() + interval '2 hours') returning id`))[0].id;
    async function market() {
      return (await as('service_role', null, `insert into public.prediction_markets
        (match_id, question, closes_at) values ($1, 'Will FaZe win?', now() + interval '1 hour') returning id`, [match]))[0].id;
    }
    const firstMarket = await market();
    await as('supabase_auth_admin', null, 'insert into auth.users values ($1)', [bob]);
    equal(await balance(alice), 1000); // Existing Auth user was backfilled.
    equal(await balance(bob), 1000); // New Auth user was initialized by trigger.
    equal((await as('authenticated', alice, 'select * from public.wallet_transactions')).length, 1);
    equal((await as('authenticated', alice, 'select * from public.profiles')).map(p => p.id), [alice]);
    equal((await db.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity")).rows[0].n, 6);

    await rejected(() => as('anon', null, 'select * from public.wallets'), /permission denied/);
    await rejected(() => as('anon', null, 'select * from public.get_leaderboard()'), /permission denied/);
    await rejected(() => as('authenticated', null, 'select * from public.purchase_prediction($1, $2, $3, $4)', [firstMarket, 'YES', 1, request]), /Authentication required/);
    await rejected(() => as('authenticated', alice, 'update public.wallets set balance = 999999'), /permission denied/);
    await rejected(() => as('authenticated', alice, 'insert into public.wallets(user_id) values ($1)', [alice]), /permission denied/);
    await rejected(() => as('authenticated', alice, 'delete from public.wallets'), /permission denied/);
    await rejected(() => as('authenticated', alice, 'truncate public.wallets cascade'), /permission denied/);
    await rejected(() => as('authenticated', alice, "insert into public.wallet_transactions(user_id, kind, amount, balance_after) values ($1, 'signup_bonus', 1000, 2000)", [alice]), /permission denied/);
    await rejected(() => as('authenticated', alice, 'insert into public.prediction_positions default values'), /permission denied/);
    await rejected(() => as('service_role', null, 'update public.wallets set balance = 999999'), /permission denied/);
    await rejected(() => as('service_role', null, "insert into public.prediction_markets(match_id, question, closes_at, status) values ($1, 'Bad', now(), 'cancelled')", [match]), /permission denied/);
    await rejected(() => as('service_role', null, "insert into public.prediction_markets(match_id, question, closes_at) values ($1, 'Too late', now() + interval '3 hours')", [match]), /no later than match start/);
    await as('authenticated', alice, "update public.profiles set display_name = 'Subigya' where id = $1", [alice]);
    equal((await as('authenticated', alice, 'select display_name from public.profiles'))[0].display_name, 'Subigya');
    equal((await as('authenticated', alice, "update public.profiles set display_name = 'Spoofed' where id = $1 returning id", [bob])).length, 0);
    await rejected(() => as('authenticated', alice, 'update public.profiles set id = $1', [bob]), /permission denied/);

    const position = (await buy(alice, firstMarket, 'YES', 600, request))[0];
    equal(await balance(alice), 400);
    equal((await buy(alice, firstMarket, 'YES', 600, request))[0].id, position.id);
    equal(await balance(alice), 400);
    await rejected(() => buy(alice, firstMarket, 'NO', 600, request), /different purchase parameters/);
    await rejected(() => buy(alice, firstMarket, 'YES', 500, '10000000-0000-0000-0000-000000000003'), /Insufficient/);
    for (const stake of [null, 0, -1, 1000000001]) {
      await rejected(() => buy(alice, firstMarket, 'YES', stake, '10000000-0000-0000-0000-000000000004'), /whole-coin stake/);
    }
    await rejected(() => as('anon', null, 'select * from public.purchase_prediction($1, $2, $3, $4)', [firstMarket, 'YES', 1, request]), /permission denied/);
    await buy(bob, firstMarket, 'NO', 200, bobRequest);
    equal((await as('authenticated', alice, 'select * from public.prediction_positions')).length, 1);
    equal(Number((await as('authenticated', alice, 'select total_coins from public.get_leaderboard() where user_id = $1', [alice]))[0].total_coins), 1000);
    await rejected(() => as('authenticated', alice, 'select public.settle_prediction_market($1, $2)', [firstMarket, 'YES']), /permission denied/);
    await rejected(() => settle(firstMarket, 'YES'), /before it closes/);

    await db.query("update public.prediction_markets set closes_at = now() - interval '1 second' where id = $1", [firstMarket]);
    await rejected(() => buy(alice, firstMarket, 'YES', 1, '10000000-0000-0000-0000-000000000005'), /Market is closed/);
    await settle(firstMarket, 'YES');
    equal(await balance(alice), 1600);
    equal(await balance(bob), 800);
    await settle(firstMarket, 'YES');
    equal(await balance(alice), 1600);
    await rejected(() => settle(firstMarket, 'NO'), /different outcome/);
    await rejected(() => settle(firstMarket, null), /different outcome/);
    equal((await buy(alice, firstMarket, 'YES', 600, request))[0].id, position.id);
    equal(await balance(alice), 1600);

    const cancelled = await market();
    await rejected(() => buy(alice, cancelled, 'YES', 600, request), /different purchase parameters/);
    await buy(bob, cancelled, 'YES', 100, '10000000-0000-0000-0000-000000000006');
    equal(await balance(bob), 700);
    await settle(cancelled, null);
    await settle(cancelled, null);
    equal(await balance(bob), 800);

    // Simulate ledger failure: the entire purchase must roll back.
    const rollbackMarket = await market();
    await db.exec(`create function public.test_reject_ledger() returns trigger language plpgsql as
      $$ begin raise exception 'simulated ledger failure'; end $$;
      create trigger test_reject_ledger before insert on public.wallet_transactions
      for each row execute function public.test_reject_ledger();`);
    await rejected(() => buy(bob, rollbackMarket, 'YES', 100, '10000000-0000-0000-0000-000000000007'), /simulated ledger failure/);
    equal(await balance(bob), 800);
    equal((await as('authenticated', bob, 'select * from public.prediction_positions where market_id = $1', [rollbackMarket])).length, 0);
    // Simulate a settlement failure after the wallet update: credits and market state roll back.
    await db.exec('drop trigger test_reject_ledger on public.wallet_transactions');
    await buy(bob, rollbackMarket, 'YES', 100, '10000000-0000-0000-0000-000000000007');
    await db.exec('create trigger test_reject_ledger before insert on public.wallet_transactions for each row execute function public.test_reject_ledger()');
    await rejected(() => settle(rollbackMarket, null), /simulated ledger failure/);
    equal(await balance(bob), 700);
    equal((await as('authenticated', bob, 'select status from public.prediction_markets where id = $1', [rollbackMarket]))[0].status, 'open');
    await db.exec('drop trigger test_reject_ledger on public.wallet_transactions');
    await settle(rollbackMarket, null);
    equal(await balance(bob), 800);

    const movedMatchMarket = await market();
    // Trusted schedule corrections must not reopen betting on an already-started match.
    await db.query("update public.matches set starts_at = now() - interval '1 minute' where id = $1", [match]);
    await rejected(() => buy(bob, movedMatchMarket, 'YES', 1, '10000000-0000-0000-0000-000000000008'), /Match has already started/);
    await settle(movedMatchMarket, null); // Schedule changes must not block refunds.

    // A unique ledger credit is a second defence even if settlement code regresses.
    await rejected(() => db.query(`insert into public.wallet_transactions(user_id, position_id, kind, amount, balance_after)
      values ($1, $2, 'prediction_refund', 600, 2200)`, [alice, position.id]), /duplicate key/);
    equal((await db.query(`select w.user_id from public.wallets w join public.wallet_transactions t on t.user_id = w.user_id
      group by w.user_id, w.balance having w.balance <> sum(t.amount)`)).rows.length, 0);
    equal((await db.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and not ('search_path=""' = any(p.proconfig))`)).rows[0].n, 0);

    const signatures = [
      ['public.initialize_prediction_user()', []],
      ['public.validate_prediction_market_window()', []],
      ['public.purchase_prediction(uuid,public.prediction_side,bigint,uuid)', ['authenticated']],
      ['public.settle_prediction_market(uuid,public.prediction_side)', ['service_role']],
      ['public.get_leaderboard(integer)', ['authenticated']],
    ];
    for (const [signature, allowed] of signatures) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const row = (await db.query('select has_function_privilege($1, $2, $3) as allowed', [role, signature, 'EXECUTE'])).rows[0];
        equal(row.allowed, allowed.includes(role));
      }
    }

    console.log(`PASS: ${checks} security/correctness assertions on isolated PostgreSQL via PGlite.`);
    console.log('Not covered: full Supabase Auth/PostgREST integration or multi-session concurrency. No live database accessed.');
  } finally {
    await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
