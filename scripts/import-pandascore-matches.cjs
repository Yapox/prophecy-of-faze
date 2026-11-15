'use strict';

// Default: PandaScore-only dry-run. --apply explicitly enables insert-only writes.
// Node.js 20+, native fetch; no npm dependencies, Auth session, or SQL execution.
const { fetchUpcomingMatches, SafeError } = require('./fetch-faze-upcoming.cjs');
const FAZE_NAMES = new Set(['faze', 'faze clan']);
const UNKNOWN_NAMES = new Set(['tbd', 'tba', 'unknown', 'unnamed opponent', 'to be determined', 'to be announced']);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const nameOf = value => typeof value === 'string' ? value.trim() : '';
const isFaze = team => FAZE_NAMES.has(nameOf(team?.name).toLowerCase());

// Accept timezone-qualified ISO timestamps, rejecting normalized impossible dates
// such as February 30 rather than trusting Date.parse alone.
function validStart(value, now) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1
      || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
      || hour > 23 || minute > 59 || second > 59) return null;
  if (parts[7] !== 'Z') {
    const [offsetHours, offsetMinutes] = parts[7].slice(1).split(':').map(Number);
    if (offsetHours > 23 || offsetMinutes > 59) return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && time > now ? new Date(time).toISOString() : null;
}

function mapMatches(matches, now = Date.now()) {
  const rows = new Map();
  const skipped = [];
  for (const match of matches) {
    const teams = Array.isArray(match?.opponents)
      ? match.opponents.filter(entry => entry?.type === 'Team' && entry.opponent).map(entry => entry.opponent)
      : [];
    if (!teams.some(isFaze)) continue;
    const skip = reason => skipped.push({ match_id: Number.isSafeInteger(match.id) ? match.id : null, reason });
    if (!Number.isSafeInteger(match.id) || match.id < 1) { skip('Invalid PandaScore match ID'); continue; }
    if (match.status !== 'not_started') { skip('Not an upcoming unstarted match'); continue; }
    if (teams.length !== 2 || teams.filter(isFaze).length !== 1) { skip('Missing or ambiguous participants'); continue; }
    const faze = teams.find(isFaze);
    const other = teams.find(team => !isFaze(team));
    const opponent = nameOf(other.name);
    if (!opponent || UNKNOWN_NAMES.has(opponent.toLowerCase()) || CONTROL.test(opponent)
        || [...opponent].length > 100
        || (other.id != null && faze.id != null && other.id === faze.id)) {
      skip('Missing, placeholder, invalid, or overlong opponent'); continue;
    }
    // Only fall back when scheduled_at is absent; an explicitly invalid schedule
    // must not silently be replaced by a possibly outdated begin_at value.
    const scheduled = match.scheduled_at == null || match.scheduled_at === '' ? match.begin_at : match.scheduled_at;
    const startsAt = validStart(scheduled, now);
    if (!startsAt) { skip('Missing, invalid, or nonfuture start time'); continue; }
    const eventParts = [match.league?.name, match.serie?.full_name || match.serie?.name, match.tournament?.name]
      .map(nameOf).filter(Boolean);
    const seenNames = new Set();
    const eventName = eventParts.filter(part => {
      const key = part.toLowerCase();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    }).join(' / ');
    if (!eventName || CONTROL.test(eventName) || [...eventName].length > 200) {
      skip('Missing, invalid, or overlong event name'); continue;
    }
    // Exact INSERT column allowlist from the migration's service_role grant.
    // id, created_at, and faze_team must use their database defaults.
    const row = {
      game: 'CS2',
      event_name: eventName,
      opponent,
      starts_at: startsAt,
      external_reference: `pandascore:match:${match.id}`,
    };
    rows.set(row.external_reference, row);
  }
  return { rows: [...rows.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at)
    || a.external_reference.localeCompare(b.external_reference)), skipped };
}

function adminConfig(env) {
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { throw new SafeError('Set a valid SUPABASE_URL for --apply.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    throw new SafeError('SUPABASE_URL must be the standard HTTPS cloud project URL, without paths or credentials.');
  }
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  const legacy = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (Boolean(secret) === Boolean(legacy)) throw new SafeError('Set exactly one server credential: SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY.');
  if (secret) {
    if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(secret)) throw new SafeError('SUPABASE_SECRET_KEY must be a server-only sb_secret_ key; publishable keys are rejected.');
    return { origin: url.origin, key: secret, legacy: false };
  }
  let payload;
  try {
    const parts = legacy.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new SafeError('SUPABASE_SERVICE_ROLE_KEY must be a valid legacy service-role JWT format.'); }
  // This check only rejects obvious key misuse. Supabase verifies the signature.
  if (payload.role !== 'service_role') throw new SafeError('Only a legacy service_role key is accepted; anon/user tokens are rejected.');
  return { origin: url.origin, key: legacy, legacy: true };
}

async function insertOnly(rows, config) {
  const url = new URL('/rest/v1/matches', config.origin);
  url.searchParams.set('on_conflict', 'external_reference');
  const headers = {
    apikey: config.key,
    'Content-Type': 'application/json',
    'Content-Profile': 'public',
    Prefer: 'resolution=ignore-duplicates,return=minimal,missing=default',
  };
  // New secret keys belong on apikey, not Authorization: Bearer.
  if (config.legacy) headers.Authorization = `Bearer ${config.key}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(rows),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SafeError('Supabase request failed or timed out. It may have committed. Inspect the database before rerunning; the same references remain safe to retry with conflict-ignore.');
  }
  // Suppress response bodies: they can contain request data or sensitive details.
  try { await response.body?.cancel(); } catch {}
  if (!response.ok) {
    throw new SafeError(`Supabase rejected the import (HTTP ${response.status}). Check server credentials, grants, constraints, or rate limits. No automatic write retry was attempted.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--dry-run', '--apply'].includes(args[0]))) {
    throw new SafeError('Usage: node scripts/import-pandascore-matches.cjs [--dry-run | --apply]. Credentials belong only in environment variables.');
  }
  const apply = args[0] === '--apply';
  const config = apply ? adminConfig(process.env) : null; // Dry-run never connects to Supabase.
  const token = process.env.PANDASCORE_API_TOKEN?.trim();
  if (!token || /\s|[\u0000-\u001f\u007f]/.test(token)) throw new SafeError('Set PANDASCORE_API_TOKEN to the token alone, without whitespace or a Bearer prefix.');
  const secrets = [token, process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY]
    .filter(Boolean).map(value => value.trim()).filter(Boolean);
  const log = value => {
    let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]');
    console.log(text);
  };

  log(apply ? 'APPLY: fetch, validate, then insert new PandaScore matches only.' : 'DRY RUN: PandaScore reads only; no Supabase requests or credentials required.');
  if (apply) log(`Target Supabase project: ${config.origin}`);
  const { matches, pages } = await fetchUpcomingMatches(token);
  const { rows, skipped } = mapMatches(matches);
  log(`Completed ${pages} PandaScore page(s). ${rows.length} valid FaZe candidates; ${skipped.length} FaZe records skipped.`);
  for (const entry of skipped) log(entry);
  log({ proposed_inserts: rows });
  if (!rows.length) { log('No eligible FaZe fixtures to import. No Supabase request was made.'); return; }
  if (!apply) {
    log('Preview is not a database diff: existing references will be ignored during --apply. Review these proposals before enabling writes.');
    return;
  }
  // Do not let a fixture that started during the scan/printing enter the import.
  const stillUpcoming = rows.filter(row => Date.parse(row.starts_at) > Date.now());
  if (stillUpcoming.length !== rows.length) throw new SafeError('A proposed match started during preparation. No import was sent; rerun the dry-run.');
  await insertOnly(rows, config);
  log(`Import request succeeded for ${rows.length} candidate(s). Existing external references were ignored; no existing row was updated. This is not a count of newly inserted rows.`);
  log('No prediction markets, positions, wallets, transactions, or settlements were written.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof SafeError ? error.message : 'Import stopped unexpectedly; raw details were suppressed to protect credentials. If a write was sent, inspect the database before retrying.');
    process.exitCode = 1;
  });
}

module.exports = { validStart, mapMatches, adminConfig };
