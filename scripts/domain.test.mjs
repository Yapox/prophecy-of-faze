import test from 'node:test';
import assert from 'node:assert/strict';
import { createPractice, loadPractice, marketIsOpen, portfolioSummary, purchasePractice, settlePractice, tradePreview } from '../src/domain.js';

const now = Date.parse('2026-11-14T22:00:00Z');
const intent = (state, requestId = 'one') => ({ userId: state.user.id, args: { p_market_id: state.markets[0].id, p_side: 'YES', p_stake: 100, p_request_id: requestId } });

test('purchase debits once and a retry retains one position and ledger debit', () => {
  const initial = createPractice(now);
  const purchase = intent(initial);
  const bought = purchasePractice(initial, purchase, now);
  assert.equal(bought.wallet.balance, 900);
  assert.equal(bought.positions.length, 1);
  assert.equal(bought.history.filter(row => row.kind === 'prediction_purchase').length, 1);
  assert.equal(purchasePractice(bought, purchase, now), bought);
  assert.equal(portfolioSummary(bought).total, 1000);
  assert.equal(portfolioSummary(bought).possiblePayout, 200);
  assert.throws(() => purchasePractice(bought, { ...purchase, args: { ...purchase.args, p_side: 'NO' } }, now), /different purchase parameters/);
});

test('winning, losing, and cancelled markets reconcile with the ledger', () => {
  for (const [side, balance, profit] of [['YES', 1100, 100], ['NO', 900, -100], [null, 1000, 0]]) {
    const initial = createPractice(now);
    const bought = purchasePractice(initial, intent(initial), now);
    const settled = settlePractice(bought, initial.markets[0].id, side, now);
    assert.equal(settled.wallet.balance, balance);
    assert.equal(portfolioSummary(settled).realized, profit);
    assert.equal(portfolioSummary(settled).committed, 0);
    assert.equal(settled.history.reduce((sum, row) => sum + row.amount, 0), balance);
    assert.equal(settlePractice(settled, initial.markets[0].id, side, now), settled);
    assert.equal(purchasePractice(settled, intent(initial), now), settled);
  }
});

test('closed markets, insufficient funds, and invalid quantities are rejected', () => {
  const state = createPractice(now);
  assert.equal(marketIsOpen(state.markets[0], state.matches[0], now), true);
  assert.equal(marketIsOpen(state.markets[0], state.matches[0], now + 7 * 3600000), false);
  assert.throws(() => purchasePractice(state, intent(state), now + 7 * 3600000), /closed/);
  assert.throws(() => purchasePractice(state, { ...intent(state), args: { ...intent(state).args, p_stake: 1001 } }, now), /enough virtual coins/);
  for (const value of [0, -1, 1.5, 'abc', 1000000001]) assert.throws(() => tradePreview(value));
});

test('practice wallet survives storage and corrupt storage has a usable fallback', () => {
  const state = createPractice(now);
  const bought = purchasePractice(state, intent(state), now);
  assert.equal(loadPractice({ getItem: () => JSON.stringify(bought) }, now).wallet.balance, 900);
  assert.equal(loadPractice({ getItem: () => '{bad' }, now).wallet.balance, 1000);
  assert.equal(loadPractice({ getItem() { throw new Error('disabled'); } }, now).wallet.balance, 1000);
});
