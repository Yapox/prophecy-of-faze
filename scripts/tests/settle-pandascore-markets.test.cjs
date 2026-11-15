'use strict';
// No real requests/credentials/SQL. Every HTTP interaction is an injected mock.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.fetch = () => { throw new Error('Real network is forbidden in offline tests'); };
const { evaluate, referenceId, run, safeLogger } = require('../settle-pandascore-markets.cjs');
const NOW = Date.parse('2030-01-02T12:00:00Z');
const env = {
  SUPABASE_URL: 'https://offline-settlement.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_FAKE_OFFLINE_ONLY',
  PANDASCORE_API_TOKEN: 'FAKE_OFFLINE_PANDA_TOKEN',
};
const clone = value => JSON.parse(JSON.stringify(value));

function market() {
  return {
    id: '20000000-0000-0000-0000-000000000001',
    match_id: '10000000-0000-0000-0000-000000000001',
    question: 'Will FaZe Clan beat fnatic?', status: 'open',
    closes_at: '2030-01-02T08:45:00Z', created_at: '2030-01-01T00:00:00Z',
    winning_side: null, settled_at: null,
    match: {
      id: '10000000-0000-0000-0000-000000000001', game: 'CS2', faze_team: 'FaZe Clan',
      opponent: 'fnatic', event_name: 'Offline competition', starts_at: '2030-01-02T09:00:00Z',
      external_reference: 'pandascore:match:1796528',
    },
  };
}
function result(winner = 3212) {
  return {
    id: 1796528, status: 'finished', draw: false, forfeit: false, rescheduled: false,
    scheduled_at: '2030-01-02T09:00:00Z', begin_at: '2030-01-02T09:02:00Z',
    end_at: '2030-01-02T11:00:00Z', modified_at: '2030-01-02T11:05:00Z',
    winner_id: winner, winner_type: 'Team', winner: { id: winner, type: 'Team' },
    opponents: [
      { type: 'Team', opponent: { id: 3212, name: 'FaZe Clan' } },
      { type: 'Team', opponent: { id: 222, name: 'fnatic' } },
    ],
    results: [{ team_id: 3212, score: winner === 3212 ? 2 : 0 }, { team_id: 222, score: winner === 222 ? 2 : 0 }],
  };
}
function harness(options = {}) {
  const state = { markets: options.markets || [market()], results: options.results || [result()], calls: [], posts: [], logs: [], sleeps: [], providerReads: 0, now: options.now ?? NOW };
  // A contract model only, not the PostgreSQL RPC implementation. Each synthetic
  // market has one 100-coin position on each side, in separate 900-coin wallets.
  // This lets dispatch/retry tests observe simulated credits without real money,
  // SQL, or claiming to prove database locking/unique-constraint behavior.
  state.positions = state.markets.flatMap((row, index) => ['YES', 'NO'].map(side => ({
    id: `offline-position-${index}-${side}`, user_id: `offline-user-${index}-${side}`,
    market_id: row.id, side, stake: 100,
  })));
  state.wallets = new Map(state.positions.map(position => [position.user_id, 900]));
  state.payouts = [];
  state.outcomes = new Map();
  const json = (data, headers = {}) => new Response(JSON.stringify(data), { status: 200, headers });
  const fetchImpl = async (input, request) => {
    const url = new URL(input);
    state.calls.push({ url: url.toString(), method: request.method });
    assert.equal(request.redirect, 'error');
    if (url.origin === env.SUPABASE_URL) {
      assert.equal(request.headers.apikey, env.SUPABASE_SECRET_KEY);
      assert.equal(request.headers.Authorization, undefined);
      if (request.method === 'GET' && url.pathname === '/rest/v1/prediction_markets') {
        if (options.dbError) return new Response('suppressed', { status: options.dbError });
        let rows = state.markets;
        if (url.searchParams.has('id')) rows = rows.filter(row => 'eq.' + row.id === url.searchParams.get('id'));
        else rows = rows.filter(row => row.status === 'open');
        const start = Number(url.searchParams.get('offset'));
        return json(clone(rows.slice(start, start + 100)), { 'Content-Range': `${start}-${start + rows.length - 1}/${rows.length}` });
      }
      assert.equal(request.method, 'POST');
      assert.equal(url.pathname, '/rest/v1/rpc/settle_prediction_market');
      assert.equal(request.headers['Content-Profile'], 'public');
      const args = JSON.parse(request.body);
      assert.deepEqual(Object.keys(args).sort(), ['p_market_id', 'p_winning_side']);
      assert.ok(['YES', 'NO'].includes(args.p_winning_side));
      state.posts.push(args);
      if (options.rpcTimeout) throw new Error(env.SUPABASE_SECRET_KEY);
      if (options.rpcError) return new Response('private response ' + env.SUPABASE_SECRET_KEY, { status: options.rpcError });
      const row = state.markets.find(row => row.id === args.p_market_id);
      assert.ok(row, 'RPC must identify one of the returned database markets');
      if (state.outcomes.has(row.id)) {
        return new Response(null, { status: state.outcomes.get(row.id) === args.p_winning_side ? 204 : 400 });
      }
      // Simulate the existing idempotent RPC contract; no real RPC is executed.
      state.outcomes.set(row.id, args.p_winning_side);
      for (const position of state.positions.filter(position => position.market_id === row.id && position.side === args.p_winning_side)) {
        const amount = position.stake * 2;
        const balance = state.wallets.get(position.user_id) + amount;
        state.wallets.set(position.user_id, balance);
        state.payouts.push({ position_id: position.id, market_id: row.id, kind: 'prediction_payout', amount, balance_after: balance });
      }
      row.status = 'resolved'; row.winning_side = args.p_winning_side; row.settled_at = new Date(state.now).toISOString();
      if (options.rpcTimeoutAfterCommit) throw new Error('Simulated lost response ' + env.SUPABASE_SECRET_KEY);
      return new Response(null, { status: 204 });
    }
    assert.equal(url.origin, 'https://api.pandascore.co');
    assert.equal(url.pathname, '/csgo/matches/past');
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.Authorization, 'Bearer ' + env.PANDASCORE_API_TOKEN);
    assert.equal(url.searchParams.has('token'), false);
    const requestedIds = url.searchParams.get('filter[id]').split(',').map(Number);
    assert.ok(requestedIds.every(id => state.markets.some(row => referenceId(row.match?.external_reference) === id)));
    state.providerReads++;
    if (options.providerError && (!options.failOnce || state.providerReads === 1)) {
      return new Response('private body ' + env.PANDASCORE_API_TOKEN, { status: options.providerError, headers: { 'Retry-After': String(options.retryAfter ?? 0) } });
    }
    if (options.onProviderRead) options.onProviderRead(state);
    return json(clone(options.ignoreResultFilter ? state.results : state.results.filter(row => requestedIds.includes(row.id))));
  };
  state.run = argv => run({ argv, env, fetchImpl, now: () => state.now,
    sleepImpl: async delay => state.sleeps.push(delay), output: line => state.logs.push(line) });
  return state;
}

test('exact external references only', () => {
  assert.equal(referenceId('pandascore:match:1796528'), 1796528);
  for (const value of ['fictional-001', 'pandascore:match:0', 'pandascore:match:01', 'pandascore:match:12x', null]) assert.equal(referenceId(value), null);
});
test('declared winner 3212 proposes YES; opponent winner proposes NO', () => {
  assert.equal(evaluate(market(), result(3212), NOW).rpc.p_winning_side, 'YES');
  assert.equal(evaluate(market(), result(222), NOW).rpc.p_winning_side, 'NO');
});

const unsafeCases = [
  ['unfinished', (_m, r) => { r.status = 'running'; }],
  ['not started', (_m, r) => { r.status = 'not_started'; }],
  ['canceled with winner', (_m, r) => { r.status = 'canceled'; }],
  ['postponed', (_m, r) => { r.status = 'postponed'; }],
  ['draw', (_m, r) => { r.draw = true; }],
  ['forfeit', (_m, r) => { r.forfeit = true; }],
  ['missing flags', (_m, r) => { delete r.draw; }],
  ['rescheduled', (_m, r) => { r.rescheduled = true; }],
  ['explicit incomplete result', (_m, r) => { r.complete = false; }],
  ['foreign match ID', (_m, r) => { r.id++; }],
  ['missing winner ID', (_m, r) => { r.winner_id = null; }],
  ['winner outside participants', (_m, r) => { r.winner_id = 999; }],
  ['name alone is insufficient', (_m, r) => { r.opponents[0].opponent.id = 999; }],
  ['duplicate team IDs', (_m, r) => { r.opponents[1].opponent.id = 3212; }],
  ['missing opponent', (_m, r) => { r.opponents.pop(); }],
  ['player winner', (_m, r) => { r.winner_type = 'Player'; }],
  ['winner fields disagree', (_m, r) => { r.winner.id = 222; }],
  ['tied scores', (_m, r) => { r.results[1].score = 2; }],
  ['winner contradicts scores', (_m, r) => { r.results[1].score = 3; }],
  ['duplicate score IDs', (_m, r) => { r.results[1].team_id = 3212; }],
  ['missing scores', (_m, r) => { delete r.results; }],
  ['missing finish time', (_m, r) => { r.end_at = null; }],
  ['future finish time', (_m, r) => { r.end_at = '2030-01-03T00:00:00Z'; }],
  ['recently updated result', (_m, r) => { r.modified_at = '2030-01-02T11:59:00Z'; }],
  ['changed schedule', (_m, r) => { r.scheduled_at = '2030-01-02T10:00:00Z'; }],
  ['wrong opposing name', (_m, r) => { r.opponents[1].opponent.name = 'Another Team'; }],
  ['fictional event label', m => { m.match.event_name = '[FICTIONAL TEST] fixture'; }],
  ['fictional reference', m => { m.match.external_reference = 'fictional-cs2-short-settlement-001'; }],
  ['original fictional market ID', m => { m.id = '82f74d17-8d7a-4c37-855e-8db49f5f88e7'; }],
  ['unrelated question', m => { m.question = 'Will FaZe win the first map?'; }],
  ['wrong game', m => { m.match.game = 'Valorant'; }],
  ['market still open for purchase', m => { m.closes_at = '2030-01-02T13:00:00Z'; }],
  ['market already resolved', m => { m.status = 'resolved'; }],
  ['market canceled', m => { m.status = 'cancelled'; }],
  ['market created after match began', m => { m.created_at = '2030-01-02T10:00:00Z'; }],
  ['match began before market closed', (_m, r) => { r.begin_at = '2030-01-02T08:30:00Z'; }],
];
for (const [name, mutate] of unsafeCases) test(`skip: ${name}`, () => {
  const m = market(); const r = result(); mutate(m, r);
  assert.equal(evaluate(m, r, NOW).eligible, false);
});

test('default and explicit dry-run send zero POSTs and propose exact RPC arguments', async () => {
  for (const argv of [[], ['--dry-run']]) {
    const h = harness(); const plans = await h.run(argv);
    assert.equal(plans.length, 1);
    assert.deepEqual(plans[0].rpc, { p_market_id: market().id, p_winning_side: 'YES' });
    assert.equal(h.posts.length, 0);
    assert.ok(h.calls.every(call => call.method === 'GET'));
  }
});
test('apply dispatch is mocked: correct RPC only, then repeat sees resolved market', async () => {
  const h = harness();
  await h.run(['--apply']);
  assert.equal(h.posts.length, 1);
  assert.deepEqual(h.posts[0], { p_market_id: market().id, p_winning_side: 'YES' });
  assert.notEqual(h.posts[0].p_market_id, market().match_id);
  assert.equal(h.payouts.length, 1);
  assert.equal(h.payouts[0].amount, 200);
  assert.equal(h.wallets.get('offline-user-0-YES'), 1100);
  assert.equal(h.wallets.get('offline-user-0-NO'), 900);
  assert.equal(h.providerReads, 2); // Initial plan and fresh pre-write evidence.
  await h.run(['--apply']);
  assert.equal(h.posts.length, 1);
  assert.equal(h.payouts.length, 1);
  assert.equal(h.wallets.get('offline-user-0-YES'), 1100);
});
test('mocked FaZe loss dispatches NO, never null/refund', async () => {
  const h = harness({ results: [result(222)] }); await h.run(['--apply']);
  assert.deepEqual(h.posts, [{ p_market_id: market().id, p_winning_side: 'NO' }]);
  assert.equal(h.payouts.length, 1);
  assert.equal(h.payouts[0].amount, 200);
  assert.equal(h.wallets.get('offline-user-0-NO'), 1100);
  assert.equal(h.wallets.get('offline-user-0-YES'), 900);
});

test('two finished matches route opposite sides to their own database market UUIDs', async () => {
  const second = market();
  second.id = '20000000-0000-0000-0000-000000000002';
  second.match_id = '10000000-0000-0000-0000-000000000002';
  second.match.id = second.match_id;
  second.match.external_reference = 'pandascore:match:1789256';
  second.match.opponent = 'Wildcard';
  second.question = 'Will FaZe Clan beat Wildcard?';
  const secondResult = result(222);
  secondResult.id = 1789256;
  secondResult.opponents[1].opponent.name = 'Wildcard';
  const h = harness({ markets: [market(), second], results: [result(3212), secondResult] });
  await h.run(['--apply']);
  assert.deepEqual(h.posts, [
    { p_market_id: market().id, p_winning_side: 'YES' },
    { p_market_id: second.id, p_winning_side: 'NO' },
  ]);
  assert.equal(h.payouts.length, 2);
  await h.run(['--apply']);
  assert.equal(h.posts.length, 2);
  assert.equal(h.payouts.length, 2);
});

test('full mocked flow blocks at 14:59.999 and permits exactly 15 minutes after latest result update', async () => {
  const readyAt = Date.parse(result().modified_at) + 15 * 60 * 1000;
  const h = harness({ now: readyAt - 1 });
  assert.equal((await h.run(['--apply'])).length, 0);
  assert.equal(h.posts.length, 0);
  assert.equal(h.payouts.length, 0);
  assert.ok(h.logs.some(line => line.includes('result_stabilization_wait')));
  h.now = readyAt;
  await h.run(['--apply']);
  assert.deepEqual(h.posts, [{ p_market_id: market().id, p_winning_side: 'YES' }]);
  assert.equal(h.payouts.length, 1);
});

test('stabilization uses the later of end_at and modified_at', async () => {
  const r = result();
  r.modified_at = '2030-01-02T10:59:00Z';
  const readyAt = Date.parse(r.end_at) + 15 * 60 * 1000;
  const h = harness({ results: [r], now: readyAt - 1 });
  await h.run(['--apply']); assert.equal(h.posts.length, 0);
  h.now = readyAt;
  await h.run(['--apply']); assert.equal(h.posts.length, 1);
});

test('new result modification restarts the stabilization wait', async () => {
  const r = result(); r.modified_at = '2030-01-02T11:59:00Z';
  const h = harness({ results: [r] });
  await h.run(['--apply']); assert.equal(h.posts.length, 0);
  h.now = Date.parse(r.modified_at) + 15 * 60 * 1000;
  await h.run(['--apply']); assert.equal(h.posts.length, 1);
});

test('result updated during pre-write recheck never dispatches before its new grace period', async () => {
  const h = harness({ onProviderRead: state => {
    if (state.providerReads === 2) state.results[0].modified_at = '2030-01-02T11:59:00Z';
  } });
  await assert.rejects(() => h.run(['--apply']), /changed during review/);
  assert.equal(h.posts.length, 0); assert.equal(h.payouts.length, 0);
});

test('committed-but-lost mocked RPC response is not automatically retried and rerun adds no credit', async () => {
  const h = harness({ rpcTimeoutAfterCommit: true });
  await assert.rejects(() => h.run(['--apply']), /may have committed/);
  assert.equal(h.posts.length, 1);
  assert.equal(h.payouts.length, 1);
  assert.equal(h.wallets.get('offline-user-0-YES'), 1100);
  await h.run(['--apply']);
  assert.equal(h.posts.length, 1);
  assert.equal(h.payouts.length, 1);
  assert.equal(h.wallets.get('offline-user-0-YES'), 1100);
});

test('dry-run for both winners makes zero RPC calls and zero simulated payouts', async () => {
  for (const winner of [3212, 222]) {
    for (const argv of [[], ['--dry-run']]) {
      const h = harness({ results: [result(winner)] });
      const plans = await h.run(argv);
      assert.equal(plans.length, 1);
      assert.equal(plans[0].rpc.p_winning_side, winner === 3212 ? 'YES' : 'NO');
      assert.equal(h.posts.length, 0);
      assert.equal(h.payouts.length, 0);
      assert.ok([...h.wallets.values()].every(balance => balance === 900));
    }
  }
});
test('ambiguous results dispatch no RPC even in mocked apply', async () => {
  for (const [, mutate] of unsafeCases) {
    const m = market(); const r = result(); mutate(m, r);
    const h = harness({ markets: [m], results: [r] });
    // A foreign provider ID is a fatal read failure, not an eligible proposal.
    try { await h.run(['--apply']); } catch (error) { assert.match(error.message, /unexpected ID/); }
    assert.equal(h.posts.length, 0);
  }
});
test('two open markets for one match require manual review', async () => {
  const second = market(); second.id = '20000000-0000-0000-0000-000000000002';
  const h = harness({ markets: [market(), second] });
  assert.equal((await h.run(['--apply'])).length, 0);
  assert.equal(h.posts.length, 0);
});
test('missing past result defers settlement', async () => {
  const h = harness({ results: [] }); assert.equal((await h.run([])).length, 0); assert.equal(h.posts.length, 0);
});
test('winner changes between plan and write: no RPC', async () => {
  const h = harness({ onProviderRead: state => { if (state.providerReads === 2) state.results = [result(222)]; } });
  await assert.rejects(() => h.run(['--apply']), /changed during review/);
  assert.equal(h.posts.length, 0);
});
test('conflicting duplicate provider records abort', async () => {
  const h = harness({ results: [result(3212), result(222)] });
  await assert.rejects(() => h.run(['--apply']), /Conflicting/); assert.equal(h.posts.length, 0);
});
test('PandaScore access failure stops before a proposal or RPC', async () => {
  const h = harness({ providerError: 403 }); await assert.rejects(() => h.run(['--apply']), /HTTP 403/);
  assert.equal(h.posts.length, 0);
});
test('unexpected provider match ID aborts instead of routing a result to the wrong market', async () => {
  const unexpected = result(); unexpected.id = 999999;
  const h = harness({ results: [unexpected], ignoreResultFilter: true });
  await assert.rejects(() => h.run(['--apply']), /unexpected ID/);
  assert.equal(h.posts.length, 0); assert.equal(h.payouts.length, 0);
});
test('429 retries are bounded and respect Retry-After', async () => {
  const once = harness({ providerError: 429, failOnce: true, retryAfter: 2 }); await once.run([]);
  assert.deepEqual(once.sleeps, [2000]);
  const repeated = harness({ providerError: 429 }); await assert.rejects(() => repeated.run([]), /HTTP 429/);
  assert.equal(repeated.providerReads, 3); assert.equal(repeated.posts.length, 0);
  const long = harness({ providerError: 429, retryAfter: 600 }); await assert.rejects(() => long.run([]), /HTTP 429/);
  assert.equal(long.providerReads, 1); assert.equal(long.sleeps.length, 0);
});
test('database access failure stops without provider or RPC requests', async () => {
  const h = harness({ dbError: 403 }); await assert.rejects(() => h.run(['--apply']), /HTTP 403/);
  assert.equal(h.providerReads, 0); assert.equal(h.posts.length, 0);
});
test('RPC failure and timeout have no automatic write retry or secret output', async () => {
  for (const options of [{ rpcError: 500 }, { rpcTimeout: true }]) {
    const h = harness(options);
    await assert.rejects(() => h.run(['--apply']), error => {
      assert.equal(error.message.includes(env.SUPABASE_SECRET_KEY), false); return true;
    });
    assert.equal(h.posts.length, 1);
  }
});
test('server credentials required; public credentials rejected', async () => {
  const h = harness();
  await assert.rejects(() => run({ env: { ...env, SUPABASE_SECRET_KEY: 'sb_publishable_FAKE' }, argv: [], fetchImpl: () => { throw new Error('Must not fetch'); } }), /server-only/);
  assert.equal(h.posts.length, 0);
});
test('known credentials are redacted from all presentation values', () => {
  const lines = []; const log = safeLogger(env, line => lines.push(line));
  log({ unexpected: env.SUPABASE_SECRET_KEY, another: env.PANDASCORE_API_TOKEN });
  assert.equal(lines.join('').includes(env.SUPABASE_SECRET_KEY), false);
  assert.equal(lines.join('').includes(env.PANDASCORE_API_TOKEN), false);
  assert.ok(lines.join('').includes('[REDACTED]'));
});
