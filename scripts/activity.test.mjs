import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySummary } from '../src/activity.js';

const now = Date.parse('2026-11-15T00:01:00Z');
const position = (date, market_id = 'a', side = 'YES', stake = 1) => ({ created_at: date, market_id, side, stake });
test('daily streaks deduplicate purchases, respect UTC boundaries, and expire after a missed day', () => {
  const data = { markets: [{ id: 'a', match_id: 'one' }, { id: 'b', match_id: 'two' }], positions: [
    position('2026-11-13T12:00:00Z'), position('2026-11-14T23:59:00Z'), position('2026-11-14T23:59:30Z'),
    position('2026-11-16T00:00:00Z'), position('invalid'),
  ] };
  const result = activitySummary(data, now);
  assert.equal(result.currentStreak, 2);
  assert.equal(result.bestStreak, 2);
  assert.equal(result.todayPredictions, 0);
  assert.equal(result.nextReset, '2026-11-16T00:00:00.000Z');
  assert.equal(activitySummary({ ...data, positions: data.positions.slice(0, 3) }, now + 86_400_000).currentStreak, 0);
  data.positions.push(position('2026-11-14T18:00:30-06:00'), position('2026-11-15T00:00:40Z', 'b'));
  const completed = activitySummary(data, now);
  assert.equal(completed.currentStreak, 3);
  assert.equal(completed.todayMatches, 2);
  assert.equal(completed.week.at(-1).active, true);
});
test('winning streaks count markets once, use net profit, ignore refunds, and break at a loss or break-even', () => {
  const markets = [
    { id: 'win', status: 'resolved', winning_side: 'YES', settled_at: '2026-11-14T15:00:00Z' },
    { id: 'refund', status: 'cancelled', settled_at: '2026-11-14T14:00:00Z' },
    { id: 'even', status: 'resolved', winning_side: 'NO', settled_at: '2026-11-14T13:00:00Z' },
    { id: 'older', status: 'resolved', winning_side: 'YES', settled_at: '2026-11-14T12:00:00Z' },
  ];
  const day = '2026-11-13T12:00:00Z';
  const positions = [position(day, 'win', 'YES', 5), position(day, 'win', 'NO', 1), position(day, 'refund'), position(day, 'even', 'YES', 2), position(day, 'even', 'NO', 2), position(day, 'older')];
  assert.equal(activitySummary({ markets, positions }, now).winningStreak, 1);
  assert.equal(activitySummary({ markets: markets.filter(m => m.id !== 'even'), positions }, now).winningStreak, 2);
});
