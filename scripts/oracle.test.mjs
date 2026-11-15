import test from 'node:test';
import assert from 'node:assert/strict';
import { createOracleHandler } from '../api/oracle.js';

const marketId = '00000000-0000-0000-0000-000000000001';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-test-key', GEMINI_API_KEY: 'server-test-key', GEMINI_MODEL: 'test-model' };
const market = { id: marketId, match_id: 'match-one', question: 'Will FaZe win?', closes_at: '2026-11-15T01:00:00Z', status: 'open', winning_side: null };
function database(_url, _key, options) {
  assert.equal(options.auth.persistSession, false);
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-one', email: 'private@example.com' } } }) },
    from(table) {
      return { select() { return this; }, eq() { return this; }, async single() { return { data: table === 'prediction_markets' ? market : { game: 'CS2', event_name: 'Test fixture', faze_team: 'FaZe Clan', opponent: 'NAVI', starts_at: '2026-11-15T02:00:00Z' } }; } };
    },
  };
}
async function call(handler, overrides = {}) {
  const response = { statusCode: 0, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer private-session-token' }, body: { marketId }, ...overrides }, response);
  return response;
}
test('Oracle rejects anonymous requests, invalid markets, and missing server configuration', async () => {
  const handler = createOracleHandler({ env: {} });
  assert.equal((await call(handler, { headers: {} })).statusCode, 401);
  assert.equal((await call(handler, { body: { marketId: 'sample-id' } })).statusCode, 400);
  assert.equal((await call(handler)).statusCode, 503);
  assert.equal((await call(handler, { method: 'GET' })).statusCode, 405);
});
test('Oracle sends match data and rules to Gemini without account information or session tokens', async () => {
  let sent;
  const handler = createOracleHandler({ env, database, fetchImpl: async (url, options) => {
    assert.match(url, /generativelanguage.googleapis.com/);
    assert.equal(options.headers['x-goog-api-key'], 'server-test-key');
    sent = options.body;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Only the match record is available.' }] } }] }) };
  } });
  const response = await call(handler);
  assert.equal(response.statusCode, 200);
  assert.match(response.body.text, /match record/);
  assert.match(sent, /FaZe Clan/);
  assert.doesNotMatch(sent, /private@example|private-session-token|user-one/);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});
test('Oracle limits repeated requests and hides raw provider errors', async () => {
  const handler = createOracleHandler({ env, database, clock: () => 1000, fetchImpl: async () => ({ ok: false }) });
  const failed = await call(handler);
  assert.equal(failed.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(failed.body), /server-test-key/);
  for (let index = 0; index < 4; index++) await call(handler);
  assert.equal((await call(handler)).statusCode, 429);
});
