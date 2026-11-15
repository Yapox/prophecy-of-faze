import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createRecentResultsReader } from '../server/recentResults.js';

// Explicitly dispatched trusted workflow only. No credential values in output,
// traces, screenshots, artifacts, or source. Never alter an existing user.
const origin = process.env.SUPABASE_URL;
const adminKey = process.env.SUPABASE_SECRET_KEY;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const site = process.env.PUBLIC_SITE_URL;
if (origin !== 'https://gkhzdoqpqjutuonysdpw.supabase.co' || !adminKey?.startsWith('sb_secret_') || !publicKey?.startsWith('sb_publishable_') || site !== 'https://yapox.github.io/prophecy-of-faze/') throw new Error('Live QA configuration is missing or targets an unexpected project.');
const nonce = randomUUID();
const email = `prophecy-qa-${nonce}@example.invalid`;
const password = `${randomUUID()}aA!`;
const client = createClient(origin, publicKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const report = { timestamp: new Date().toISOString(), site, account: 'Temporary admin-confirmed QA account', emailConfirmation: 'Not tested: admin confirmation does not verify signup email delivery', purchases: [], cleanup: 'pending' };
let userId, browser, failed = false, stage = 'create temporary account';
async function admin(path, method, body) {
  const response = await fetch(`${origin}/auth/v1/admin/users${path}`, { method, headers: { apikey: adminKey, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Admin account operation returned HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
function unwrap(result) { if (result.error) throw new Error('Authenticated database request failed'); return result.data; }
try {
  const created = await admin('', 'POST', { email, password, email_confirm: true, app_metadata: { prophecy_qa_run: nonce } });
  userId = created.id;
  assert.match(userId, /^[0-9a-f-]{36}$/i);
  stage = 'sign in and verify signup wallet';
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || signed.data.user?.id !== userId) throw new Error('Generated QA account could not sign in');
  const wallet = unwrap(await client.from('wallets').select('balance').eq('user_id', userId).single());
  assert.equal(Number(wallet.balance), 1000);
  const bonus = unwrap(await client.from('wallet_transactions').select('amount').eq('user_id', userId).eq('kind', 'signup_bonus'));
  assert.equal(bonus.length, 1); assert.equal(Number(bonus[0].amount), 1000);
  report.signupWallet = '1000 coins, exactly one signup bonus';
  const matches = unwrap(await client.from('matches').select('id,game,opponent,event_name,starts_at,external_reference').order('starts_at'));
  const markets = unwrap(await client.from('prediction_markets').select('id,match_id,question,status,closes_at'));
  const refs = ['pandascore:match:1796528', 'pandascore:match:1789256'];
  report.requestedMatches = refs.map(reference => {
    const match = matches.find(row => row.external_reference === reference);
    return { reference, found: Boolean(match), linkedQuestions: match ? markets.filter(market => market.match_id === match.id).map(market => market.question) : [] };
  });
  const imported = matches.find(match => match.game === 'CS2' && match.external_reference?.startsWith('pandascore:match:'));
  if (imported) {
    const sample = await createRecentResultsReader()(imported, process.env.PANDASCORE_API_TOKEN);
    report.providerResults = sample.available ? { available: true, inspected: sample.scannedMatches, teams: sample.teams.map(team => ({ name: team.name, results: team.played, wins: team.wins })) } : { available: false, reason: sample.reason };
  }
  stage = 'browser sign in and published match display';
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', () => pageErrors.push('Browser JavaScript error'));
  await page.goto(site, { waitUntil: 'networkidle' });
  await page.locator('header').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('#email').fill(email); await page.locator('#password').fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.wallet-pill')).toContainText('1,000', { timeout: 30_000 });
  await page.locator('.main-nav').getByRole('link', { name: 'Markets', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include settled markets' }).check();
  for (const match of report.requestedMatches) {
    if (match.found && match.linkedQuestions.length) {
      for (const question of match.linkedQuestions) await expect(page.locator('.market-card').filter({ hasText: question }).first()).toBeVisible();
      match.browserDisplay = 'Questions displayed';
    }
  }
  const eligible = markets.filter(market => {
    const match = matches.find(row => row.id === market.match_id);
    return match?.external_reference?.startsWith('pandascore:match:') && market.status === 'open' && Date.parse(market.closes_at) > Date.now() + 60_000 && Date.parse(match.starts_at) > Date.now() + 60_000;
  }).slice(0, 2);
  let expectedBalance = 1000;
  for (const [index, market] of eligible.entries()) {
    stage = 'browser simulated prediction';
    const card = page.locator('.market-card').filter({ hasText: market.question }).first();
    await expect(card).toBeVisible();
    await card.locator(index === 0 ? '.yes-button' : '.no-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#contract-count').fill('5');
    await dialog.getByRole('button', { name: 'Confirm simulated trade', exact: true }).click();
    await expect(dialog).toContainText('Your prediction is placed.', { timeout: 30_000 });
    expectedBalance -= 5;
    await expect(page.locator('.wallet-pill')).toContainText(String(expectedBalance));
    await dialog.getByRole('button', { name: 'View portfolio', exact: true }).click();
    const positions = unwrap(await client.from('prediction_positions').select('id,request_id,stake').eq('user_id', userId).eq('market_id', market.id));
    assert.equal(positions.length, 1); assert.equal(Number(positions[0].stake), 5);
    // Retry exactly the browser's request ID. The wallet must not debit twice.
    unwrap(await client.rpc('purchase_prediction', { p_market_id: market.id, p_side: index === 0 ? 'YES' : 'NO', p_stake: 5, p_request_id: positions[0].request_id }));
    const after = unwrap(await client.from('wallets').select('balance').eq('user_id', userId).single());
    assert.equal(Number(after.balance), expectedBalance);
    report.purchases.push({ question: market.question, side: index === 0 ? 'YES' : 'NO', stake: 5, balanceAfter: expectedBalance, duplicateRetry: 'No second debit' });
    await page.locator('.main-nav').getByRole('link', { name: 'Markets', exact: true }).click();
  }
  if (!eligible.length) report.purchaseStatus = 'Not tested: no future open imported market was available. No market was reopened or settled.';
  stage = 'portfolio, history, leaderboard, and persistence';
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.wallet-pill')).toContainText(new Intl.NumberFormat('en-US').format(expectedBalance), { timeout: 30_000 });
  report.sessionPersistence = 'Browser reload preserves authenticated account and balance';
  await page.locator('.main-nav').getByRole('link', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('Signup bonus');
  if (eligible.length) await expect(page.locator('tbody')).toContainText('Prediction purchase');
  const leaderboard = unwrap(await client.rpc('get_leaderboard', { p_limit: 50 }));
  await page.locator('.main-nav').getByRole('link', { name: 'Leaderboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The leaderboard.' })).toBeVisible();
  report.leaderboard = { loaded: true, entries: leaderboard.length, qaUserIncluded: leaderboard.some(row => row.user_id === userId) };
  assert.deepEqual(pageErrors, []);
  await page.locator('header').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.wallet-pill')).toHaveCount(0);
  report.logout = 'Private wallet cleared';
  report.livePayout = 'Not tested: no real match outcome was altered';
  report.result = 'Completed available deployed-account checks';
} catch {
  failed = true; report.result = 'Failed'; report.failedStage = stage;
  console.error(`Live QA failed during: ${stage}. Credentials and raw responses were suppressed.`);
} finally {
  await browser?.close(); await client.auth.signOut().catch(() => {});
  if (userId) {
    try {
      // Delete only the account ID created in this run after verifying its tag.
      const user = await admin(`/${userId}`, 'GET');
      if (user.app_metadata?.prophecy_qa_run !== nonce) throw new Error('QA identity guard failed');
      await admin(`/${userId}`, 'DELETE');
      report.cleanup = 'Temporary QA account deleted; its wallet, positions and ledger rows cascade deleted';
    } catch { failed = true; report.cleanup = 'Cleanup needs operator review'; console.error('QA cleanup could not be confirmed. No existing user was targeted.'); }
  }
  await mkdir('artifacts/live-integration', { recursive: true });
  await writeFile('artifacts/live-integration/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (failed) process.exitCode = 1;
}
