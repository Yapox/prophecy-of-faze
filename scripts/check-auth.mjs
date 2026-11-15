import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5173/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.BroadcastChannel = undefined;
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Simulate } = await import('react-dom/test-utils');
// Stub project credentials for the DOM test. No requests to a live project.
const server = await createServer({
  server: { middlewareMode: true }, appType: 'custom',
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.invalid'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_dom_test') },
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
});
const root = createRoot(document.getElementById('root'));
const { supabase } = await server.ssrLoadModule('/src/api.js');
async function input(id, value) {
  await act(async () => { Simulate.change(document.getElementById(id), { target: { value } }); });
}
try {
  const { default: AuthDialog } = await server.ssrLoadModule('/src/components/AuthDialog.jsx');
  let closed = false, signInCount = 0;
  supabase.auth.signInWithPassword = async ({ email, password }) => {
    signInCount++;
    assert.equal(email, 'frontend-test@example.com');
    assert.equal(password.length, 6);
    return { data: { session: { user: { id: 'test-user' } } }, error: null };
  };
  await act(async () => root.render(createElement(AuthDialog, { onClose() { closed = true; }, onPractice() {} })));
  await input('email', 'frontend-test@example.com');
  await input('password', 'sixchr');
  assert.equal(document.getElementById('password').hasAttribute('minlength'), false);
  await act(async () => Simulate.submit(document.querySelector('form')));
  assert.equal(signInCount, 1);
  assert.equal(closed, true);

  await act(async () => document.querySelector('.auth-switch').click());
  assert.equal(document.getElementById('password').minLength, 8);
  await input('password', 'new-test-password');
  let signupCount = 0, finishSignup;
  supabase.auth.signUp = async options => {
    signupCount++;
    assert.equal(options.options.emailRedirectTo, 'http://localhost:5173/');
    return new Promise(resolve => { finishSignup = resolve; });
  };
  closed = false;
  await act(async () => {
    Simulate.submit(document.querySelector('form'));
    Simulate.submit(document.querySelector('form'));
  });
  assert.equal(signupCount, 1);
  await act(async () => finishSignup({ data: { user: { id: 'test-user' }, session: null }, error: null }));
  assert.equal(closed, false);
  assert.match(document.body.textContent, /Check your email for confirmation/);
  assert.equal(document.getElementById('password').value, '');
  console.log('PASS: login accepts an existing shorter password; signup uses the current origin, requires confirmation, clears the password, and ignores duplicate submits.');
  console.log('Controlled DOM responses only. No real account was created or signed in.');
} finally {
  await act(async () => root.unmount());
  await supabase.auth.stopAutoRefresh();
  await server.close();
  dom.window.close();
}
