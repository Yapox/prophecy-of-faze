import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// Question/opponent strings follow Subigya's SQL setup. UUIDs and dates are
// synthetic fixtures, not a read of the deployed database.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5173/#markets' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.BroadcastChannel = undefined;
window.scrollTo = () => {};
window.localStorage.setItem('faze-mode', 'live');
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const server = await createServer({
  server: { middlewareMode: true }, appType: 'custom',
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.invalid'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_dom_test') },
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
});
const { supabase } = await server.ssrLoadModule('/src/api.js');
const user = { id: '00000000-0000-0000-0000-000000000001' };
const future = hours => new Date(Date.now() + hours * 3600000).toISOString();
const matches = [
  { id: '00000000-0000-0000-0000-000000000011', game: 'CS2', faze_team: 'FaZe Clan', opponent: 'fnatic', event_name: 'Controlled account fixture A', external_reference: 'pandascore:match:1796528', starts_at: future(6) },
  { id: '00000000-0000-0000-0000-000000000012', game: 'CS2', faze_team: 'FaZe Clan', opponent: 'Wildcard', event_name: 'Controlled account fixture B', external_reference: 'pandascore:match:1789256', starts_at: future(12) },
];
const tables = {
  matches,
  prediction_markets: matches.map((match, index) => ({ id: `00000000-0000-0000-0000-00000000002${index + 1}`, match_id: match.id, question: `Will FaZe Clan beat ${match.opponent}?`, closes_at: future(index ? 11 : 5), status: 'open', winning_side: null, settled_at: null })),
  wallets: [{ user_id: user.id, balance: 1000 }], prediction_positions: [],
  wallet_transactions: [{ id: 'bonus', user_id: user.id, kind: 'signup_bonus', amount: 1000, balance_after: 1000, created_at: new Date().toISOString() }],
};
let authCallback, currentUser = user, purchaseCalls = [], loseFirstResponse = true;
supabase.auth.getUser = async () => ({ data: { user: currentUser }, error: null });
supabase.auth.onAuthStateChange = callback => {
  authCallback = callback;
  queueMicrotask(() => callback('INITIAL_SESSION', { user }));
  return { data: { subscription: { unsubscribe() {} } } };
};
supabase.auth.signOut = async () => { currentUser = null; authCallback('SIGNED_OUT', null); return { error: null }; };
supabase.from = table => {
  assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
  const filters = []; let columns = null, start = 0, end = Infinity, single = false;
  const query = {
    select(value) { columns = value.split(','); return this; }, order() { return this; },
    range(first, last) { start = first; end = last; return this; },
    eq(column, value) { filters.push([column, value]); return this; }, single() { single = true; return this; },
    then(resolve, reject) {
      let rows = tables[table].filter(row => filters.every(([key, value]) => row[key] === value)).slice(start, end + 1);
      rows = rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]])));
      return Promise.resolve({ data: single ? rows[0] : rows, error: null }).then(resolve, reject);
    },
  };
  return query;
};
supabase.rpc = async (name, args) => {
  if (name === 'get_leaderboard') return { data: [{ rank: 1, user_id: user.id, display_name: 'Test predictor', total_coins: tables.wallets[0].balance + tables.prediction_positions.reduce((sum, item) => sum + item.stake, 0) }], error: null };
  assert.equal(name, 'purchase_prediction');
  assert.deepEqual(Object.keys(args).sort(), ['p_market_id', 'p_request_id', 'p_side', 'p_stake']);
  assert.equal(args.p_stake, 100);
  purchaseCalls.push({ ...args });
  const previous = tables.prediction_positions.find(position => position.request_id === args.p_request_id);
  if (previous) return { data: { ...previous }, error: null };
  const position = { id: `position-${args.p_request_id}`, user_id: user.id, market_id: args.p_market_id, side: args.p_side, stake: args.p_stake, request_id: args.p_request_id, created_at: new Date().toISOString() };
  tables.wallets[0].balance -= args.p_stake;
  tables.prediction_positions.push(position);
  tables.wallet_transactions.push({ id: `debit-${position.id}`, user_id: user.id, position_id: position.id, kind: 'prediction_purchase', amount: -100, balance_after: tables.wallets[0].balance, created_at: position.created_at });
  if (loseFirstResponse) { loseFirstResponse = false; return { data: null, error: new TypeError('Controlled lost response after commit') }; }
  return { data: { ...position }, error: null };
};
const root = createRoot(document.getElementById('root'));
async function click(element) {
  assert.ok(element, 'Expected a clickable element');
  await act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
}
async function navigate(page) {
  await act(async () => { window.location.hash = page; window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
}
try {
  const { default: App } = await server.ssrLoadModule('/src/OdysseyApp.jsx');
  await act(async () => root.render(createElement(App)));
  const cards = [...document.querySelectorAll('.market-card')];
  assert.equal(cards.length, 2);
  for (const [index, opponent] of ['fnatic', 'Wildcard'].entries()) {
    assert.match(cards[index].textContent, new RegExp(`Will FaZe Clan beat ${opponent}\\?`));
    assert.equal(cards[index].querySelectorAll('.team-seal')[1].textContent, opponent[0].toUpperCase());
    assert.match(cards[index].querySelector('.data-label').textContent, /PandaScore/);
    assert.equal(cards[index].querySelector('.yes-button').disabled, false);
  }
  await click(cards[0].querySelector('.yes-button'));
  await click(document.querySelector('dialog form .button-primary'));
  assert.match(document.querySelector('dialog').textContent, /outcome is uncertain/);
  assert.equal(tables.wallets[0].balance, 900);
  assert.equal(tables.prediction_positions.length, 1);
  assert.equal(purchaseCalls.length, 1);
  const pending = JSON.parse(window.sessionStorage.getItem(`faze-pending-purchase:${user.id}`));
  assert.equal(pending.args.p_request_id, purchaseCalls[0].p_request_id);
  await click(document.querySelector('dialog form .button-primary'));
  assert.deepEqual(purchaseCalls[1], purchaseCalls[0]);
  assert.equal(tables.wallets[0].balance, 900);
  assert.equal(tables.prediction_positions.length, 1);
  assert.equal(window.sessionStorage.getItem(`faze-pending-purchase:${user.id}`), null);
  assert.match(document.querySelector('dialog').textContent, /Your prediction is placed/);
  await click([...document.querySelectorAll('dialog button')].find(button => button.textContent === 'View portfolio'));
  await navigate('portfolio');
  assert.match(document.body.textContent, /Will FaZe Clan beat fnatic/);
  assert.match(document.querySelector('.wallet-pill').textContent, /900/);
  await navigate('markets');
  const wildcardCard = [...document.querySelectorAll('.market-card')].find(card => card.textContent.includes('Wildcard'));
  await click(wildcardCard.querySelector('.no-button'));
  await click(document.querySelector('dialog form .button-primary'));
  assert.match(document.querySelector('dialog').textContent, /Your prediction is placed/);
  assert.equal(purchaseCalls[2].p_side, 'NO');
  assert.equal(purchaseCalls[2].p_market_id, tables.prediction_markets[1].id);
  assert.equal(tables.wallets[0].balance, 800);
  assert.equal(tables.prediction_positions.length, 2);
  assert.equal(tables.wallet_transactions.length, 3);
  await click(document.querySelector('dialog .icon-button'));
  await navigate('leaderboard');
  assert.match(document.body.textContent, /1,000 coins/);
  await click([...document.querySelectorAll('header button')].find(button => button.textContent === 'Sign out'));
  assert.doesNotMatch(document.body.textContent, /Test predictor/);
  assert.equal(document.querySelector('.wallet-pill'), null);
  console.log('PASS: account-mode DOM renders both imported-question fixtures, buys YES and NO, retries a lost response without a duplicate debit, refreshes the wallet/portfolio/leaderboard, and clears private data on logout.');
  console.log('Controlled Supabase responses only. UUIDs/dates are synthetic; no deployed rows were read and no live coins were spent.');
} finally {
  await act(async () => root.unmount());
  await supabase.auth.stopAutoRefresh();
  await server.close();
  dom.window.close();
}
