import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const user = '00000000-0000-0000-0000-000000000101';
const other = '00000000-0000-0000-0000-000000000102';
async function asRole(role, sql, values = []) {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, values); } finally { await db.exec('reset role'); }
}
const first = result => Object.values(result.rows[0])[0];
const balance = async () => Number(first(await db.query('select balance from public.wallets where user_id = $1', [user])));
const sync = async fixture => first(await asRole('service_role', 'select public.sync_pandascore_match($1::jsonb)', [JSON.stringify(fixture)]));
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;`);
  for (const path of ['supabase/migrations/20261114000000_initial_backend.sql', 'supabase/migrations/20261115000000_automation_and_oracle_limits.sql']) await db.exec(await readFile(path, 'utf8'));
  await db.query('insert into auth.users(id) values ($1), ($2)', [user, other]);
  assert.equal(await balance(), 1000);
  assert.equal(Number(first(await db.query("select count(*) from public.wallet_transactions where user_id = $1 and kind = 'signup_bonus'", [user]))), 1);
  const fixture = { game: 'CS2', event_name: 'Isolated SQL fixture', opponent: 'fnatic', external_reference: 'pandascore:match:900000001', starts_at: new Date(Date.now() + 86_400_000).toISOString() };
  await assert.rejects(asRole('authenticated', 'select public.sync_pandascore_match($1::jsonb)', [JSON.stringify(fixture)]), /permission denied/);
  const created = await sync(fixture);
  assert.equal(created.action, 'match_and_market_created');
  assert.equal((await sync(fixture)).action, 'existing_market');
  assert.equal(Number(first(await db.query('select count(*) from public.prediction_markets where match_id = $1', [created.match_id]))), 1);
  const rescheduled = { ...fixture, starts_at: new Date(Date.parse(fixture.starts_at) + 3_600_000).toISOString() };
  const changed = await sync(rescheduled);
  assert.equal(changed.action, 'untraded_fixture_rescheduled');
  assert.equal(Number(first(await db.query("select count(*) from public.prediction_markets where match_id = $1 and status = 'open'", [created.match_id]))), 1);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  const request = '00000000-0000-0000-0000-000000000111';
  const buy = () => asRole('authenticated', "select (public.purchase_prediction($1, 'YES', 10, $2)).id", [changed.market_id, request]);
  assert.equal(first(await buy()), first(await buy()));
  assert.equal(await balance(), 990);
  assert.equal((await asRole('authenticated', 'select * from public.wallets')).rows.length, 1, 'Wallet RLS exposes only the current account');
  await assert.rejects(asRole('authenticated', "select public.purchase_prediction($1, 'YES', 10000, gen_random_uuid())", [changed.market_id]), /Insufficient/);
  assert.equal(await balance(), 990);
  const drift = await sync({ ...rescheduled, starts_at: new Date(Date.parse(rescheduled.starts_at) + 3_600_000).toISOString() });
  assert.equal(drift.action, 'refunded_review_required');
  assert.equal(await balance(), 1000);
  assert.equal(new Date(first(await db.query('select starts_at from public.matches where id = $1', [created.match_id]))).toISOString(), rescheduled.starts_at);
  assert.equal(first(await db.query('select status from public.prediction_markets where id = $1', [changed.market_id])), 'cancelled');
  await sync({ ...rescheduled, starts_at: new Date(Date.parse(rescheduled.starts_at) + 3_600_000).toISOString() });
  assert.equal(await balance(), 1000, 'Repeated source drift never refunds twice');

  const secondFixture = { ...fixture, external_reference: 'pandascore:match:900000002' };
  const second = await sync(secondFixture);
  await asRole('authenticated', "select public.purchase_prediction($1, 'YES', 20, gen_random_uuid())", [second.market_id]);
  assert.equal(await balance(), 980);
  await db.query("update public.prediction_markets set closes_at = now() - interval '2 hours', created_at = now() - interval '3 hours' where id = $1", [second.market_id]);
  await db.query("update public.matches set starts_at = now() - interval '1 hour' where id = $1", [second.match_id]);
  const evidence = { market_id: second.market_id, external_reference: secondFixture.external_reference, faze_team_id: 3212, opponent_team_id: 99, winner_team_id: 3212, rpc: { p_market_id: second.market_id, p_winning_side: 'YES' } };
  const settle = () => asRole('service_role', "select public.settle_pandascore_prediction($1, 'YES', $2::jsonb)", [second.market_id, JSON.stringify(evidence)]);
  await settle(); await settle();
  assert.equal(await balance(), 1020);
  assert.equal(Number(first(await db.query("select count(*) from public.wallet_transactions where user_id = $1 and kind = 'prediction_payout'", [user]))), 1);
  assert.equal(Number(first(await db.query("select count(*) from public.prediction_operations where market_id = $1 and action = 'pandascore_settlement'", [second.market_id]))), 1);
  await assert.rejects(asRole('service_role', "select public.settle_pandascore_prediction($1, 'NO', $2::jsonb)", [second.market_id, JSON.stringify(evidence)]), /evidence/);
  await assert.rejects(asRole('authenticated', 'select * from public.prediction_operations'), /permission denied/);
  for (let index = 0; index < 5; index++) assert.equal(first(await asRole('authenticated', 'select public.reserve_oracle_request()')), true);
  assert.equal(first(await asRole('authenticated', 'select public.reserve_oracle_request()')), false);
  await db.exec("update public.oracle_request_limits set requests = 500 where bucket like 'day:%'");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
  assert.equal(first(await asRole('authenticated', 'select public.reserve_oracle_request()')), false);
  await assert.rejects(asRole('anon', 'select public.reserve_oracle_request()'), /permission denied/);
  console.log('PASS: actual in-memory PostgreSQL migrations, signup bonus, wallet RLS, duplicate purchase, insufficient funds rollback, atomic match/market sync, reschedule refunds, idempotent payouts/receipts, service-only permissions, and durable Oracle quotas.');
  console.log('Isolated PGlite database only. No deployed accounts, matches, or wallets changed. Multi-process concurrency and Supabase Auth still require live testing.');
} catch (error) {
  console.error('Database check failed:', error.message, error.position ? `at SQL position ${error.position}` : '', error.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
