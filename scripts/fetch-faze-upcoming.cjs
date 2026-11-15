'use strict';

// Read-only PandaScore preview. Node.js 20+; no packages or Supabase credentials.
// Docs: https://developers.pandascore.co/reference/get_csgo_matches_upcoming-1
// Auth: https://developers.pandascore.co/docs/authentication
const { setTimeout: sleep } = require('node:timers/promises');

const ENDPOINT = 'https://api.pandascore.co/csgo/matches/upcoming';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const MAX_RETRIES = 2;
const MAX_WAIT_MS = 30_000;
// Exact names only: do not match academies, other organizations, or match titles.
const FAZE_NAMES = new Set(['faze', 'faze clan']);
class SafeError extends Error {}

function retryDelay(value, now = Date.now()) {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.ceil(Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

async function requestPage(page, token) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('page[number]', String(page));
  url.searchParams.set('page[size]', String(PAGE_SIZE));
  url.searchParams.set('sort', 'begin_at,id');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        redirect: 'error', // Do not forward credentials to another location.
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      if (attempt === MAX_RETRIES) throw new SafeError('Network/timeout failure after three attempts. Check connectivity and rerun later.');
      console.error('Network/timeout failure; retrying the same read-only page.');
      await sleep(1000 * (2 ** attempt));
      continue;
    }

    if (!response.ok) {
      const status = response.status;
      const retryAfter = retryDelay(response.headers.get('retry-after'));
      // Never print remote error bodies, headers, token, or raw fetch errors.
      try { await response.body?.cancel(); } catch {}
      if (status === 401) throw new SafeError('PandaScore rejected authentication (401). Check PANDASCORE_API_TOKEN privately.');
      if (status === 403) throw new SafeError('PandaScore denied access (403). Check the token, account, and plan coverage.');
      if (status === 429 || status >= 500) {
        const delay = retryAfter ?? (1000 * (2 ** attempt));
        if (attempt === MAX_RETRIES || delay > MAX_WAIT_MS) {
          const hint = retryAfter === null ? 'Check the PandaScore dashboard before retrying.'
            : `Wait at least ${Math.ceil(retryAfter / 1000)} seconds before retrying.`;
          throw new SafeError(`PandaScore ${status === 429 ? 'rate limit (429)' : `server error (${status})`}. ${hint}`);
        }
        console.error(`PandaScore HTTP ${status}; retrying this page in ${Math.ceil(delay / 1000)} seconds.`);
        await sleep(delay);
        continue;
      }
      throw new SafeError(`PandaScore HTTP ${status}. Check endpoint parameters and account access; response details were suppressed.`);
    }

    let matches;
    try { matches = await response.json(); }
    catch { throw new SafeError('PandaScore returned invalid JSON or the response timed out.'); }
    if (!Array.isArray(matches)) throw new SafeError('Unexpected PandaScore response: expected a match array.');
    const link = response.headers.get('link');
    const hasNext = link === null ? matches.length === PAGE_SIZE : /rel\s*=\s*"?next"?(?=\s|,|;|$)/i.test(link);
    return { matches, hasNext, remaining: response.headers.get('x-rate-limit-remaining') };
  }
}

function isFaze(team) {
  return typeof team?.name === 'string' && FAZE_NAMES.has(team.name.trim().toLowerCase());
}

function toFazeRows(matches, now = Date.now()) {
  const rows = [];
  for (const match of matches) {
    if (!Number.isSafeInteger(match?.id) || match.status !== 'not_started') continue;
    const teams = Array.isArray(match.opponents)
      ? match.opponents.filter(entry => entry?.type === 'Team' && entry.opponent).map(entry => entry.opponent)
      : [];
    const faze = teams.find(isFaze);
    if (!faze) continue;
    // scheduled_at is the scheduled fixture time; begin_at is a fallback.
    const dates = [match.scheduled_at, match.begin_at].filter(value => typeof value === 'string');
    const time = dates.map(Date.parse).find(Number.isFinite);
    if (time !== undefined && time <= now) continue;
    const opponents = teams.filter(team => !isFaze(team));
    rows.push({
      matchId: match.id,
      startsAt: time === undefined ? null : new Date(time).toISOString(),
      fazeTeamId: Number.isSafeInteger(faze.id) ? faze.id : null,
      opponent: opponents.map(team => team.name || 'Unnamed opponent').join(' / ') || 'TBD',
      league: match.league?.name || 'TBD',
      series: match.serie?.full_name || match.serie?.name || 'TBD',
      tournament: match.tournament?.name || 'TBD',
    });
  }
  return rows.sort((a, b) => (a.startsAt || '9999').localeCompare(b.startsAt || '9999') || a.matchId - b.matchId);
}

// Shared read-only fetch for the preview and importer. Finish pagination before
// returning any data, so an incomplete/failed API scan cannot start an import.
async function fetchUpcomingMatches(token) {
  const matches = new Map();
  let complete = false;
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await requestPage(page, token);
    pages++;
    for (const match of response.matches) {
      if (Number.isSafeInteger(match?.id)) matches.set(match.id, match);
    }
    if (!response.hasNext) { complete = true; break; }
    if (response.matches.length === 0) throw new SafeError('Empty page with a next-page link; the schedule scan is incomplete. Rerun later.');
    if (response.remaining !== null && /^\d+$/.test(response.remaining) && Number(response.remaining) === 0) {
      throw new SafeError('PandaScore quota exhausted before pagination finished. No complete schedule is available; retry after quota renewal.');
    }
  }
  if (!complete) throw new SafeError(`Stopped at the ${MAX_PAGES}-page safety limit. Results are incomplete; review the request budget before increasing MAX_PAGES.`);
  return { matches: [...matches.values()], pages };
}

async function main() {
  if (process.argv.length > 2) throw new SafeError('No command-line arguments are accepted. Supply the token only through PANDASCORE_API_TOKEN.');
  const token = process.env.PANDASCORE_API_TOKEN?.trim();
  if (!token) throw new SafeError('Set PANDASCORE_API_TOKEN in this PowerShell session first.');
  if (/\s|[\u0000-\u001f\u007f]/.test(token)) throw new SafeError('The token contains whitespace/control characters. Supply the token alone, without the Bearer prefix.');

  // Defense in depth: redact the token even if an unexpected data field echoes it.
  const clean = value => String(value).replaceAll(token, '[REDACTED]').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 500);
  const { matches, pages } = await fetchUpcomingMatches(token);
  const rows = toFazeRows(matches);
  console.log(`Read ${matches.length} upcoming Counter-Strike records across ${pages} page(s).`);
  console.log('FaZe filter: exact team names "FaZe" or "FaZe Clan" (case-insensitive).');
  if (!rows.length) {
    console.log('No upcoming FaZe matches were found in the available schedule. Dates/opponents may not yet be announced, or the provider may use a different exact team name.');
    return;
  }
  for (const row of rows) {
    console.log(`\nPandaScore match ID: ${row.matchId}`);
    console.log(`Date (UTC): ${row.startsAt || 'TBD / missing schedule'}`);
    console.log(`Teams: FaZe Clan vs ${clean(row.opponent)}`);
    console.log(`FaZe PandaScore team ID: ${row.fazeTeamId ?? 'TBD'}`);
    console.log(`League: ${clean(row.league)}`);
    console.log(`Series: ${clean(row.series)}`);
    console.log(`Tournament: ${clean(row.tournament)}`);
  }
  console.log('\nPreview only. No Supabase reads, inserts, markets, purchases, or settlements.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof SafeError ? error.message : 'Unexpected failure; raw details were suppressed to protect the API token.');
    process.exitCode = 1;
  });
}

module.exports = { retryDelay, toFazeRows, fetchUpcomingMatches, SafeError };
