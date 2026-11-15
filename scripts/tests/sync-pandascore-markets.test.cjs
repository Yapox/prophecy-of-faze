const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../sync-pandascore-markets.cjs');
const now = Date.parse('2030-01-01T00:00:00Z');
const env = { PANDASCORE_API_TOKEN: 'OFFLINE_PROVIDER_KEY', SUPABASE_URL: 'https://offline.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_OFFLINE' };
const fixture = { id: 1234, status: 'not_started', scheduled_at: '2030-01-02T00:00:00Z', league: { name: 'Offline league' }, opponents: [{ type: 'Team', opponent: { id: 3212, name: 'FaZe' } }, { type: 'Team', opponent: { id: 99, name: 'fnatic' } }] };
function harness(options = {}) {
  const posts = [], logs = [];
  const args = { env, now: () => now, output: line => logs.push(line), fetchMatches: async () => ({ matches: options.matches || [fixture] }), fetchImpl: async (url, request) => {
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(url.pathname, '/rest/v1/rpc/sync_pandascore_match');
    assert.equal(request.headers.apikey, env.SUPABASE_SECRET_KEY);
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(request.redirect, 'error');
    posts.push(JSON.parse(request.body));
    if (options.timeout) throw new Error(env.SUPABASE_SECRET_KEY);
    return new Response(JSON.stringify({ action: options.action || 'match_and_market_created', match_id: 'offline-match', market_id: 'offline-market' }), { status: options.status || 200 });
  } };
  return { posts, logs, run: argv => run({ ...args, argv }) };
}
test('sync preview does not call Supabase and uses exact FaZe team identity', async () => {
  const h = harness({ matches: [fixture, { ...fixture, id: 1235, opponents: [{ type: 'Team', opponent: { id: 999, name: 'FaZe' } }, fixture.opponents[1]] }] });
  assert.equal((await h.run(['--dry-run'])).length, 1);
  assert.equal(h.posts.length, 0);
});
test('sync apply sends only the validated fixture to an atomic server RPC', async () => {
  const h = harness(); await h.run(['--apply']);
  assert.deepEqual(Object.keys(h.posts[0]), ['p_fixture']);
  assert.equal(h.posts[0].p_fixture.external_reference, 'pandascore:match:1234');
  assert.doesNotMatch(h.logs.join(''), /OFFLINE_PROVIDER_KEY|sb_secret_OFFLINE/);
});
test('sync excludes fixtures that close within five minutes', async () => {
  const h = harness({ matches: [{ ...fixture, scheduled_at: '2030-01-01T00:04:00Z' }] });
  await h.run(['--apply']); assert.equal(h.posts.length, 0);
});
test('sync surfaces refunds for review and never retries an uncertain write automatically', async () => {
  const review = harness({ action: 'refunded_review_required' }); await review.run(['--apply']);
  assert.match(review.logs.join(''), /Review required/);
  const failed = harness({ timeout: true }); await assert.rejects(failed.run(['--apply']), /may have committed/);
  assert.equal(failed.posts.length, 1);
  assert.doesNotMatch(failed.logs.join(''), /sb_secret_OFFLINE/);
});
