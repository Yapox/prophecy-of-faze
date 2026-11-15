import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { createOracleHandler } from '../api/oracle.js';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5173/#oracle' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.BroadcastChannel = undefined;
const { createElement, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const server = await createServer({
  server: { middlewareMode: true }, appType: 'custom',
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.invalid'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_chat_test') },
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
});
const { supabase } = await server.ssrLoadModule('/src/api.js');
supabase.auth.getSession = async () => ({ data: { session: { access_token: 'test-session-only' } } });
const matches = ['fnatic', 'Wildcard'].map((opponent, index) => ({ id: `match-${index}`, game: 'CS2', event_name: 'Controlled chat fixture', faze_team: 'FaZe Clan', opponent, starts_at: '2026-12-01T15:00:00Z' }));
const markets = matches.map((match, index) => ({ id: `00000000-0000-0000-0000-00000000001${index}`, match_id: match.id, question: `Will FaZe Clan beat ${match.opponent}?`, status: 'open', closes_at: '2026-12-01T14:00:00Z', winning_side: null }));
const requests = [], providerPayloads = [];
let deferred = null, failNext = false, ticks = 0, authClicks = 0;
const handler = createOracleHandler({
  env: { SUPABASE_URL: 'https://test.invalid', SUPABASE_PUBLISHABLE_KEY: 'public-test', GEMINI_API_KEY: 'server-key-only', GEMINI_MODEL: 'test-model' },
  clock: () => ++ticks * 60_000, // Each test request gets a distinct rate-limit window.
  database: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user', email: 'not-for-gemini@example.com' } } }) },
    from(table) {
      let id;
      return { select() { return this; }, eq(_column, value) { id = value; return this; }, single: async () => ({ data: (table === 'matches' ? matches : markets).find(row => row.id === id) }) };
    },
  }),
  fetchImpl: async (_url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'server-key-only');
    providerPayloads.push(JSON.parse(options.body));
    if (deferred) return new Promise(resolve => { deferred.resolve = resolve; });
    if (failNext) { failNext = false; return { ok: false, status: 429 }; }
    return reply('A correct contract returns 2 virtual coins, including the stake.');
  },
});
function reply(text) { return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }; }
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, '/api/oracle', 'DOM test must never call an external service');
  assert.equal(options.headers.apikey, 'sb_publishable_chat_test');
  const body = JSON.parse(options.body);
  assert.doesNotMatch(options.body, /server-key-only|not-for-gemini@example/);
  requests.push(body);
  const response = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value) { this.body = value; } };
  // Intentionally let cancelled mocked requests complete to exercise stale-response protection.
  await handler({ method: 'POST', headers: { authorization: options.headers.Authorization }, body }, response);
  return { ok: response.statusCode === 200, status: response.statusCode, headers: { get: name => response.headers[name.toLowerCase()] }, json: async () => JSON.parse(response.body) };
};
const root = createRoot(document.getElementById('root'));
let setSelected;
function Harness({ Oracle, authenticated = true, mode = 'live' }) {
  const [selected, updateSelected] = useState(markets[0].id);
  setSelected = updateSelected;
  const arena = { mode, authenticated, sample: mode === 'demo', session: authenticated ? { user: { id: 'test-user' } } : null, data: { matches, markets } };
  return createElement(Oracle, { arena, selectedMarket: selected, onSelect: updateSelected, onAuth: () => authClicks++ });
}
async function click(element) {
  assert.ok(element, 'Expected a clickable element');
  await act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
}
async function type(text) {
  const field = document.getElementById('oracle-question');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(field, text);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function submitTwice() {
  await act(async () => {
    const form = document.querySelector('.oracle-composer');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}
try {
  const { default: Oracle } = await server.ssrLoadModule('/src/pages/Oracle.jsx');
  const render = props => act(async () => root.render(createElement(Harness, { Oracle, ...props })));
  await render({ authenticated: false });
  assert.equal(document.querySelector('textarea'), null);
  await click(document.querySelector('.empty-state button'));
  assert.equal(authClicks, 1);
  assert.equal(requests.length, 0);
  await render({});
  assert.equal(document.querySelector('label[for="oracle-question"]').textContent, 'Your question');
  assert.equal(document.querySelector('textarea').maxLength, 1000);
  await click(document.querySelector('.oracle-suggestions button'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].marketId, markets[0].id);
  assert.deepEqual(requests[0].history, []);
  assert.match(document.querySelector('[role="log"]').textContent, /2 virtual coins/);

  await type('What happens if FaZe loses?');
  await submitTwice();
  assert.equal(requests.length, 2, 'An immediate duplicate submit sends only one request');
  assert.equal(requests[1].message, 'What happens if FaZe loses?');
  assert.equal(requests[1].history.length, 2, 'Follow-up includes the successful prior turn');
  assert.deepEqual(requests[1].history.map(item => item.role), ['user', 'model']);
  assert.match(providerPayloads[1].systemInstruction.parts[0].text, /fnatic/);
  assert.doesNotMatch(JSON.stringify(providerPayloads), /test-session-only|not-for-gemini@example/);

  failNext = true;
  await type('What data is missing?');
  await submitTwice();
  assert.match(document.querySelector('[role="alert"]').textContent, /provider limit/);
  assert.equal(document.querySelector('textarea').value, 'What data is missing?');
  const successfulMessages = document.querySelectorAll('.oracle-message').length;
  assert.equal(successfulMessages, 4, 'A failed request does not add a fake reply or duplicate question');
  await click(document.querySelector('.oracle-composer button'));
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.querySelectorAll('.oracle-message').length, 6);

  await click(document.querySelector('.oracle-chat-heading button'));
  assert.equal(document.querySelectorAll('.oracle-message').length, 0);
  deferred = {};
  await type('A question for the old match');
  await submitTwice();
  assert.match(document.querySelector('.oracle-chat-status').textContent, /replying/);
  const oldReply = deferred;
  await act(async () => setSelected(markets[1].id));
  assert.equal(document.querySelectorAll('.oracle-message').length, 0);
  assert.equal(document.querySelector('textarea').value, '');
  await act(async () => oldReply.resolve(reply('This old fnatic response must be discarded.')));
  assert.doesNotMatch(document.querySelector('[role="log"]').textContent, /old fnatic/);
  deferred = null;
  await type('Explain the selected prediction.');
  await click(document.querySelector('.oracle-composer button'));
  assert.equal(requests.at(-1).marketId, markets[1].id);
  assert.deepEqual(requests.at(-1).history, []);
  assert.match(providerPayloads.at(-1).systemInstruction.parts[0].text, /Wildcard/);
  await render({ authenticated: false });
  assert.equal(document.querySelector('[role="log"]'), null);
  await render({ mode: 'demo' });
  assert.equal(document.querySelector('textarea'), null);
  assert.match(document.body.textContent, /not AI-generated/);
  assert.equal(window.localStorage.length, 0, 'Chat is not persisted to local storage');
  console.log('PASS: Oracle chat uses the API helper and server handler with controlled Gemini responses; sign-in gating, suggestions, follow-ups, duplicate protection, quota retry, new chat, match-change cancellation, stale replies, and logout/practice behavior work.');
  console.log('No live Gemini, Supabase, or browser visual inspection was performed.');
} finally {
  await act(async () => root.unmount());
  globalThis.fetch = originalFetch;
  await supabase.auth.stopAutoRefresh();
  await server.close();
  dom.window.close();
}
