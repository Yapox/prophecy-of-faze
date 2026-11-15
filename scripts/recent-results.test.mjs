import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResults, createRecentResultsReader } from '../server/recentResults.js';
const now = Date.parse('2026-11-15T00:00:00Z');
const result = { id: 123, status: 'finished', draw: false, forfeit: false, winner_id: 3212, end_at: '2026-11-14T12:00:00Z', opponents: [{ type: 'Team', opponent: { id: 3212, name: 'FaZe' } }, { type: 'Team', opponent: { id: 99, name: 'fnatic' } }], results: [{ team_id: 3212, score: 2 }, { team_id: 99, score: 1 }] };
test('provider result samples reject incomplete and conflicting results without inventing performance', () => {
  const records = [result, result, { ...result, id: 124, forfeit: true }, { ...result, id: 125, winner_id: 100 }, { ...result, id: 126, end_at: '2026-11-16T00:00:00Z' }];
  const teams = summarizeResults(records, 'fnatic', now);
  assert.deepEqual(teams.map(team => [team.played, team.wins]), [[1, 1], [1, 0]]);
  assert.equal(teams[0].results[0].opponent, 'fnatic');
  assert.equal(summarizeResults(records, 'Unknown', now)[1].played, 0);
  const conflicting = { ...result, id: 127, opponents: [result.opponents[0], { type: 'Team', opponent: { id: 100, name: 'fnatic' } }], results: [result.results[0], { team_id: 100, score: 1 }] };
  assert.equal(summarizeResults([...records, conflicting], 'fnatic', now)[1].played, 0);
});
test('recent results are server-authenticated, cached, bounded, and fail with a clear unavailable state', async () => {
  let calls = 0;
  const read = createRecentResultsReader({ clock: () => now, fetchImpl: async (url, options) => {
    calls++; assert.equal(url.origin, 'https://api.pandascore.co'); assert.equal(options.headers.Authorization, 'Bearer private-provider-key'); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => [result], headers: new Headers() };
  } });
  const match = { game: 'CS2', external_reference: 'pandascore:match:1796528', opponent: 'fnatic' };
  assert.equal((await read(match)).available, false);
  const [a, b] = await Promise.all([read(match, 'private-provider-key'), read(match, 'private-provider-key')]);
  assert.equal(a.teams[0].wins, 1); assert.equal(b.scannedMatches, 1); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(a), /private-provider-key/);
  const unavailable = createRecentResultsReader({ fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.equal((await unavailable(match, 'key')).available, false);
});
