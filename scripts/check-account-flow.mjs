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
// JSDOM has no viewport observer. Scroll visibility is checked in Chromium.
globalThis.IntersectionObserver = window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// Old saved preferences must not keep users on sample fixtures.
window.localStorage.setItem('faze-mode', 'demo');
Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
let syncTimer, syncTimerCleared = false;
const originalSetInterval = window.setInterval.bind(window);
const originalClearInterval = window.clearInterval.bind(window);
window.setInterval = (callback, delay, ...args) => {
  if (delay === 30_000) { syncTimer = callback; return 987654; }
  return originalSetInterval(callback, delay, ...args);
};
window.clearInterval = id => {
  if (id === 987654) { syncTimerCleared = true; return; }
  originalClearInterval(id);
};
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
let authCallback, currentUser = null, purchaseCalls = [], loseFirstResponse = true, matchReads = 0;
supabase.auth.getUser = async () => ({ data: { user: currentUser }, error: null });
supabase.auth.onAuthStateChange = callback => {
  authCallback = callback;
  queueMicrotask(() => callback('INITIAL_SESSION', null));
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
      if (table === 'matches') matchReads++;
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
  assert.match(document.body.textContent, /Sign in to see live FaZe matches/);
  assert.equal(document.querySelectorAll('.market-card').length, 0, 'Signed-out account mode must not substitute sample fixtures');
  assert.equal(matchReads, 0, 'Do not query protected rows before sign-in');
  await act(async () => { currentUser = user; authCallback('SIGNED_IN', { user }); });
  const cards = [...document.querySelectorAll('.market-card')];
  assert.equal(cards.length, 2);
  for (const [index, opponent] of ['fnatic', 'Wildcard'].entries()) {
    assert.match(cards[index].textContent, new RegExp(`Will FaZe Clan beat ${opponent}\\?`));
    assert.equal(cards[index].querySelectorAll('.team-seal')[1].textContent, opponent[0].toUpperCase());
    assert.equal(cards[index].querySelector('.source-indicator')?.getAttribute('aria-label'), 'Imported match from PandaScore');
    assert.equal(cards[index].querySelector('.data-label'), null);
    assert.equal(cards[index].querySelector('.yes-button').disabled, false);
  }
  const initialReads = matchReads;
  tables.prediction_markets[0].question += ' Best of three.';
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  assert.ok(matchReads > initialReads);
  assert.match(document.querySelector('.market-card').textContent, /Best of three/);
  const focusReads = matchReads;
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  await act(async () => syncTimer());
  assert.equal(matchReads, focusReads, 'Hidden tabs do not poll');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await act(async () => syncTimer());
  assert.ok(matchReads > focusReads, 'Visible tabs poll updated backend records');
  const pollReads = matchReads;
  await act(async () => window.dispatchEvent(new window.Event('online')));
  assert.ok(matchReads > pollReads, 'Reconnect refreshes account records');
  await click(document.querySelector('.market-card .yes-button'));
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
  // A backend import arriving after initial load appears without a page reload.
  await navigate('markets');
  const addedMatch = { ...matches[0], id: '00000000-0000-0000-0000-000000000013', opponent: 'New fixture opponent', external_reference: 'pandascore:match:9999999', starts_at: future(24) };
  tables.matches.push(addedMatch);
  tables.prediction_markets.push({ ...tables.prediction_markets[1], id: '00000000-0000-0000-0000-000000000023', match_id: addedMatch.id, question: 'Will FaZe Clan beat New fixture opponent?', closes_at: future(23) });
  await act(async () => syncTimer());
  assert.equal(document.querySelectorAll('.market-card').length, 3);
  assert.match(document.body.textContent, /Will FaZe Clan beat New fixture opponent/);
  // Settlement data is read from the backend, never calculated into its wallet.
  tables.prediction_markets[0].status = 'resolved';
  tables.prediction_markets[0].winning_side = 'YES';
  tables.wallets[0].balance = 1000;
  tables.wallet_transactions.push({ id: 'controlled-payout', user_id: user.id, position_id: tables.prediction_positions[0].id, kind: 'prediction_payout', amount: 200, balance_after: 1000, created_at: new Date().toISOString() });
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  assert.equal(document.querySelectorAll('.market-card').length, 2, 'Resolved market leaves the open list');
  assert.match(document.querySelector('.wallet-pill').textContent, /1,000/);
  await navigate('portfolio');
  await click([...document.querySelectorAll('.portfolio-tabs button')].find(button => button.textContent === 'Settled positions'));
  assert.match(document.querySelector('tbody').textContent, /YES won/);
  assert.match(document.querySelector('tbody').textContent, /\+100 coins/);
  await click([...document.querySelectorAll('header button')].find(button => button.textContent === 'Sign out'));
  assert.doesNotMatch(document.body.textContent, /Test predictor/);
  assert.equal(document.querySelector('.wallet-pill'), null);
  assert.equal(syncTimerCleared, true, 'Sign-out cleans up automatic refresh');
  await navigate('markets');
  assert.equal(document.querySelectorAll('.market-card').length, 0, 'Sign-out never replaces backend records with samples');
  const signedOutReads = matchReads;
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  assert.equal(matchReads, signedOutReads, 'Sign-out removes the focus refresh listener');
  // Recovery links must open the password form even for an already-known user.
  await act(async () => { currentUser = user; authCallback('PASSWORD_RECOVERY', { user }); });
  assert.match(document.querySelector('dialog').textContent, /Choose a new password/);
  assert.ok(document.getElementById('confirm-password'));
  await click(document.querySelector('dialog .icon-button'));
  console.log('PASS: account-mode DOM renders both imported-question fixtures, buys YES and NO, retries a lost response without a duplicate debit, refreshes the wallet/portfolio/leaderboard, and clears private data on logout.');
  console.log('Controlled Supabase responses only. UUIDs/dates are synthetic; no deployed rows were read and no live coins were spent.');
  console.log('PASS: saved practice preference cannot hide account mode; signed-out mode has no sample fallback; focus, visible polling, reconnect, and sign-out cleanup work.');
} finally {
  await act(async () => root.unmount());
  await supabase.auth.stopAutoRefresh();
  await server.close();
  dom.window.close();
}
