import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
// Node's BroadcastChannel would keep this DOM-only test process alive.
globalThis.BroadcastChannel = undefined;
window.scrollTo = () => {};
window.localStorage.setItem('faze-mode', 'demo');
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };

const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [], entries: [] } });
const root = createRoot(document.getElementById('root'));
async function click(element) {
  assert.ok(element, 'Expected a clickable element');
  await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
}
async function navigate(page) {
  await act(async () => { window.location.hash = page; window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
}
try {
  const { default: App } = await server.ssrLoadModule('/src/OdysseyApp.jsx');
  await act(async () => { root.render(createElement(App)); });
  assert.match(document.body.textContent, /Predict the Game/);
  assert.match(document.body.textContent, /Ithaca/);
  // Configured projects open account mode. Practice is an explicit action.
  const practiceButton = [...document.querySelectorAll('button')].find(button => button.textContent === 'Try practice mode');
  if (practiceButton) await click(practiceButton);
  assert.equal(document.querySelectorAll('.cinematic-hero .market-card').length, 1);
  await click(document.querySelector('.cinematic-hero .yes-button'));
  assert.equal(document.querySelector('dialog').open, true);
  assert.match(document.querySelector('dialog').textContent, /Return if correct200 coins/);
  const confirmButton = document.querySelector('dialog button[type="submit"], dialog form .button-primary');
  await act(async () => {
    confirmButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    confirmButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  assert.match(document.querySelector('dialog').textContent, /Your prediction is placed/);
  assert.match(document.querySelector('.wallet-pill').textContent, /900/);
  await click([...document.querySelectorAll('dialog button')].find(button => button.textContent === 'View portfolio'));
  await navigate('portfolio');
  assert.match(document.body.textContent, /Possible return200/);
  assert.equal(document.querySelectorAll('tbody tr').length, 1);
  await click([...document.querySelectorAll('.resolution-actions button')].find(button => button.textContent === 'FaZe wins'));
  assert.match(document.querySelector('.wallet-pill').textContent, /1,100/);
  assert.match(document.body.textContent, /Simulated profit \/ loss\+100/);
  await click([...document.querySelectorAll('.portfolio-tabs button')].find(button => button.textContent === 'Transactions'));
  assert.equal(document.querySelectorAll('tbody tr').length, 3);
  await navigate('leaderboard');
  assert.match(document.body.textContent, /1,100 coins/);
  await navigate('markets');
  await click([...document.querySelectorAll('.filter-tabs button')].find(button => button.textContent === 'Valorant'));
  assert.equal(document.querySelectorAll('.market-card').length, 2);
  await navigate('terms');
  assert.match(document.body.textContent, /DRAFT FOR REVIEW/);
  await navigate('privacy');
  assert.match(document.body.textContent, /Data stored in your browser/);
  console.log('PASS: DOM flow covers landing, YES purchase, wallet debit, portfolio, simulated settlement, transactions, leaderboard, filters, and legal navigation.');
  console.log('This is a DOM test, not a desktop/mobile visual browser inspection.');
} finally {
  await act(async () => root.unmount());
  const { supabase } = await server.ssrLoadModule('/src/api.js');
  await supabase?.auth.stopAutoRefresh();
  await server.close();
  dom.window.close();
}
