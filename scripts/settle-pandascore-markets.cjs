'use strict';

// Server-side only. Default: GET-only settlement preview. No scheduling/deployment.
const { setTimeout: sleep } = require('node:timers/promises');
const { adminConfig, validStart } = require('./import-pandascore-matches.cjs');
const { SafeError, retryDelay } = require('./fetch-faze-upcoming.cjs');
const FAZE_ID = 3212;
const GRACE_MS = 15 * 60 * 1000;
const MAX_PAGES = 50;
const PAGE_SIZE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAZE_NAMES = new Set(['faze', 'faze clan']);
const normalized = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const positiveId = value => Number.isSafeInteger(value) && value > 0;
// Reuse strict ISO validation, with no future-only restriction for result dates.
const instant = value => { const iso = validStart(value, -Infinity); return iso ? Date.parse(iso) : NaN; };

function referenceId(value) {
  const match = typeof value === 'string' && /^pandascore:match:([1-9]\d*)$/.exec(value);
  return match && positiveId(Number(match[1])) ? Number(match[1]) : null;
}

function evaluate(market, result, now = Date.now()) {
  const skip = reason => ({ eligible: false, reason });
  const match = market?.match;
  const id = referenceId(match?.external_reference);
  if (!UUID.test(market?.id || '') || !UUID.test(match?.id || '') || market.match_id !== match.id || !id) return skip('invalid_database_identity');
  if (market.id === '82f74d17-8d7a-4c37-855e-8db49f5f88e7'
      || match.game !== 'CS2' || match.faze_team !== 'FaZe Clan'
      || /fictional|\btest\b/i.test(`${match.event_name} ${match.opponent} ${market.question}`)) return skip('fictional_or_wrong_game');
  if (!match.opponent || market.question !== `Will FaZe Clan beat ${match.opponent}?`) return skip('unsupported_market_question');
  if (market.status !== 'open' || market.winning_side !== null || market.settled_at !== null) return skip('not_an_unsettled_market');
  const closes = instant(market.closes_at);
  const starts = instant(match.starts_at);
  const created = instant(market.created_at);
  if (![closes, starts, created].every(Number.isFinite) || closes > now || starts > now
      || closes >= starts || created >= closes) return skip('invalid_or_unclosed_market_window');
  if (!result) return skip('no_past_result_available');
  if (result.id !== id || result.status !== 'finished') return skip('not_a_finished_matching_result');
  // Canceled/forfeit matches can have a winner_id. Never treat that as played.
  if (result.draw !== false || result.forfeit !== false || result.rescheduled === true) return skip('draw_forfeit_reschedule_or_missing_flags');
  if (result.rescheduled != null && typeof result.rescheduled !== 'boolean') return skip('invalid_reschedule_flag');
  if (result.complete != null && result.complete !== true) return skip('explicitly_incomplete_result');
  const scheduled = instant(result.scheduled_at);
  const began = instant(result.begin_at);
  const ended = instant(result.end_at);
  const modified = instant(result.modified_at);
  if (![scheduled, began, ended, modified].every(Number.isFinite)
      || scheduled !== starts || began <= closes || ended < began || ended > now || modified > now
      || created >= began) return skip('invalid_result_timing_or_schedule_drift');
  if (now - Math.max(ended, modified) < GRACE_MS) return skip('result_stabilization_wait');
  if (!Array.isArray(result.opponents) || result.opponents.length !== 2
      || result.opponents.some(entry => entry?.type !== 'Team' || !positiveId(entry.opponent?.id))) return skip('invalid_team_participants');
  const teams = result.opponents.map(entry => entry.opponent);
  const ids = teams.map(team => team.id);
  if (new Set(ids).size !== 2 || !ids.includes(FAZE_ID)) return skip('faze_3212_not_a_unique_participant');
  const faze = teams.find(team => team.id === FAZE_ID);
  const opponent = teams.find(team => team.id !== FAZE_ID);
  if (!FAZE_NAMES.has(normalized(faze.name)) || normalized(opponent.name) !== normalized(match.opponent)) return skip('participant_name_identity_mismatch');
  if (!positiveId(result.winner_id) || !ids.includes(result.winner_id)) return skip('missing_or_foreign_winner_id');
  if (result.winner_type != null && result.winner_type !== 'Team') return skip('winner_is_not_a_team');
  if (result.winner != null && (result.winner.id !== result.winner_id
      || (result.winner.type != null && result.winner.type !== 'Team'))) return skip('winner_fields_disagree');
  // Match scores confirm the declared winner; scores never select a winner alone.
  if (!Array.isArray(result.results) || result.results.length !== 2
      || result.results.some(row => !ids.includes(row?.team_id) || !Number.isSafeInteger(row.score) || row.score < 0)
      || new Set(result.results.map(row => row.team_id)).size !== 2) return skip('missing_or_invalid_team_scores');
  const winnerScore = result.results.find(row => row.team_id === result.winner_id).score;
  const loserScore = result.results.find(row => row.team_id !== result.winner_id).score;
  if (winnerScore <= loserScore) return skip('winner_and_scores_disagree');
  return {
    eligible: true,
    market_id: market.id,
    external_reference: match.external_reference,
    pandascore_match_id: id,
    faze_team_id: FAZE_ID,
    opponent_team_id: opponent.id,
    winner_team_id: result.winner_id,
    end_at: result.end_at,
    modified_at: result.modified_at,
    rpc: { p_market_id: market.id, p_winning_side: result.winner_id === FAZE_ID ? 'YES' : 'NO' },
  };
}

function safeLogger(env, output = console.log) {
  const secrets = [env.PANDASCORE_API_TOKEN, env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY]
    .filter(Boolean).map(value => value.trim()).filter(Boolean);
  return value => {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]');
    output(text);
  };
}

function supabaseHeaders(config) {
  return { apikey: config.key, 'Accept-Profile': 'public',
    ...(config.legacy ? { Authorization: `Bearer ${config.key}` } : {}) };
}

async function getJson(url, headers, io, label) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    let response;
    try {
      response = await io.fetch(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch {
      if (attempt === 2) throw new SafeError(`${label}: network/timeout failure. No raw request details logged.`);
      await io.sleep(1000 * (2 ** attempt));
      continue;
    }
    if (!response.ok) {
      const status = response.status;
      const after = retryDelay(response.headers.get('retry-after'));
      try { await response.body?.cancel(); } catch {}
      if ((status === 429 || status >= 500) && attempt < 2 && (after ?? 0) <= 30_000) {
        await io.sleep(after ?? 1000 * (2 ** attempt));
        continue;
      }
      throw new SafeError(`${label}: HTTP ${status}. Check access/quota and retry later. Any earlier successful settlements remain committed.`);
    }
    let data;
    try { data = await response.json(); } catch { throw new SafeError(`${label}: invalid JSON or response timeout.`); }
    if (!Array.isArray(data)) throw new SafeError(`${label}: expected an array; stopped safely.`);
    return { data, headers: response.headers };
  }
}

const SELECT = 'id,match_id,question,status,closes_at,winning_side,settled_at,created_at,match:matches!inner(id,game,event_name,faze_team,opponent,starts_at,external_reference)';
async function loadMarkets(config, io, marketId) {
  const rows = [];
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const url = new URL('/rest/v1/prediction_markets', config.origin);
    url.searchParams.set('select', SELECT);
    url.searchParams.set('order', 'id.asc');
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    if (marketId) url.searchParams.set('id', `eq.${marketId}`);
    else {
      url.searchParams.set('status', 'eq.open');
      url.searchParams.set('match.external_reference', 'like.pandascore:match:*');
    }
    const { data, headers } = await getJson(url, { ...supabaseHeaders(config), Prefer: 'count=exact' }, io, 'Supabase market read');
    rows.push(...data);
    offset += data.length;
    const totalText = headers.get('content-range')?.split('/')[1];
    const total = /^\d+$/.test(totalText || '') ? Number(totalText) : null;
    if ((total !== null && offset >= total) || (total === null && data.length < PAGE_SIZE)) return rows;
    if (!data.length) throw new SafeError('Supabase pagination stopped before the reported total.');
  }
  throw new SafeError('Supabase market page limit reached; stopped before any settlement.');
}

async function loadResults(ids, token, io) {
  const results = new Map();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    const allowed = new Set(batch);
    let complete = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      // The list endpoint is available on Fixtures; single-match lookup is not.
      const url = new URL('https://api.pandascore.co/csgo/matches/past');
      url.searchParams.set('filter[id]', batch.join(','));
      url.searchParams.set('page[number]', String(page));
      url.searchParams.set('page[size]', String(PAGE_SIZE));
      url.searchParams.set('sort', '-begin_at,-id');
      const { data, headers } = await getJson(url, { Accept: 'application/json', Authorization: `Bearer ${token}` }, io, 'PandaScore past matches');
      for (const result of data) {
        if (!allowed.has(result?.id)) throw new SafeError('PandaScore returned an unexpected ID outside the requested filter; stopped safely.');
        if (results.has(result.id) && JSON.stringify(results.get(result.id)) !== JSON.stringify(result)) throw new SafeError('Conflicting PandaScore records for the same match ID; manual review required.');
        results.set(result.id, result);
      }
      const link = headers.get('link');
      const next = link === null ? data.length === PAGE_SIZE : /rel\s*=\s*"?next"?(?=\s|,|;|$)/i.test(link);
      if (!next) { complete = true; break; }
      if (!data.length || headers.get('x-rate-limit-remaining') === '0') throw new SafeError('PandaScore scan incomplete or quota exhausted.');
    }
    if (!complete) throw new SafeError('PandaScore page limit reached; stopped before any settlement.');
  }
  return results;
}

async function callSettlement(plan, config, io) {
  const url = new URL('/rest/v1/rpc/settle_prediction_market', config.origin);
  let response;
  try {
    response = await io.fetch(url, { method: 'POST',
      headers: { ...supabaseHeaders(config), 'Content-Type': 'application/json', 'Content-Profile': 'public' },
      body: JSON.stringify(plan.rpc), redirect: 'error', signal: AbortSignal.timeout(30_000) });
  } catch { throw new SafeError('Settlement response lost/timeout. It may have committed. Inspect this market before rerunning; never change the outcome to force a retry.'); }
  try { await response.body?.cancel(); } catch {}
  if (!response.ok) throw new SafeError(`Settlement RPC failed (HTTP ${response.status}). Stop and inspect; earlier markets may have committed. No automatic write retry.`);
}

async function run({ argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch,
  sleepImpl = sleep, now = Date.now, output = console.log } = {}) {
  if (argv.length > 1 || (argv.length && !['--dry-run', '--apply'].includes(argv[0]))) throw new SafeError('Use --dry-run (default) or --apply; pass credentials only through environment variables.');
  const apply = argv[0] === '--apply';
  const config = adminConfig(env); // Read-only planning still needs private DB reads.
  const token = env.PANDASCORE_API_TOKEN?.trim();
  if (!token || /\s|[\u0000-\u001f\u007f]/.test(token)) throw new SafeError('Set PANDASCORE_API_TOKEN to the token alone.');
  const log = safeLogger(env, output);
  const io = { fetch: fetchImpl, sleep: sleepImpl };
  log(`${apply ? 'APPLY' : 'DRY RUN / GET ONLY'}: ${config.origin}; FaZe ID ${FAZE_ID}; 15-minute result stabilization wait.`);
  const markets = await loadMarkets(config, io);
  const ids = [...new Set(markets.map(market => referenceId(market.match?.external_reference)).filter(Boolean))];
  const results = await loadResults(ids, token, io);
  const counts = new Map();
  for (const market of markets) counts.set(market.match_id, (counts.get(market.match_id) || 0) + 1);
  const plans = [];
  for (const market of markets) {
    const decision = counts.get(market.match_id) > 1 ? { eligible: false, reason: 'multiple_open_markets_for_match' }
      : evaluate(market, results.get(referenceId(market.match?.external_reference)), now());
    if (decision.eligible) plans.push(decision);
    else log({ action: 'skip', market_id: UUID.test(market.id || '') ? market.id : null, reason: decision.reason });
  }
  for (const plan of plans) log({ action: 'proposed_settlement', ...plan });
  if (!apply) { log(`Dry-run complete: ${plans.length} proposal(s); zero settlement calls.`); return plans; }
  for (const plan of plans) {
    // Re-fetch both sources before each write. No plan-file replay or forced outcome.
    const freshMarkets = await loadMarkets(config, io, plan.market_id);
    const freshResults = await loadResults([plan.pandascore_match_id], token, io);
    if (freshMarkets.length !== 1) throw new SafeError('Market disappeared or became ambiguous before settlement.');
    const fresh = evaluate(freshMarkets[0], freshResults.get(plan.pandascore_match_id), now());
    if (!fresh.eligible || JSON.stringify(fresh) !== JSON.stringify(plan)) throw new SafeError('Market/result changed during review; stopped before settling this market. Earlier settlements may have committed.');
    await callSettlement(fresh, config, io);
    log({ action: 'settlement_rpc_succeeded', market_id: plan.market_id, side: plan.rpc.p_winning_side });
  }
  return plans;
}

if (require.main === module) run().catch(error => {
  console.error(error instanceof SafeError ? error.message : 'Settlement stopped unexpectedly; raw details suppressed to protect credentials. Inspect state if any RPC was sent.');
  process.exitCode = 1;
});

module.exports = { evaluate, referenceId, run, safeLogger };
