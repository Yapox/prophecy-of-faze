'use strict';
const { fetchUpcomingMatches, SafeError } = require('./fetch-faze-upcoming.cjs');
const { mapMatches, adminConfig } = require('./import-pandascore-matches.cjs');
const { safeLogger } = require('./settle-pandascore-markets.cjs');

async function run({ argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch, fetchMatches = fetchUpcomingMatches, now = Date.now, output = console.log } = {}) {
  if (argv.length > 1 || argv.length && !['--dry-run', '--apply'].includes(argv[0])) throw new SafeError('Use --dry-run (default) or --apply.');
  const apply = argv[0] === '--apply';
  const token = env.PANDASCORE_API_TOKEN?.trim();
  if (!token || /\s|[\u0000-\u001f\u007f]/.test(token)) throw new SafeError('Configure the server-only PandaScore token.');
  const config = apply ? adminConfig(env) : null;
  const log = safeLogger(env, output);
  const { matches } = await fetchMatches(token);
  // Require the known FaZe team identity in addition to the importer's names.
  const identified = matches.filter(match => match?.opponents?.some(entry => entry?.type === 'Team' && entry.opponent?.id === 3212 && ['faze', 'faze clan'].includes(entry.opponent.name?.trim().toLowerCase())));
  const { rows, skipped } = mapMatches(identified, now());
  const eligible = rows.filter(row => Date.parse(row.starts_at) - 300_000 > now());
  log({ mode: apply ? 'apply' : 'dry-run', candidates: eligible, skipped: skipped.length + rows.length - eligible.length });
  if (!apply) { log('No database writes. Apply requires the automation migration.'); return eligible; }
  for (const fixture of eligible) {
    if (Date.parse(fixture.starts_at) - 300_000 <= now()) throw new SafeError('A fixture closed before publication. Rerun with fresh provider data.');
    const headers = { apikey: config.key, 'Content-Type': 'application/json' };
    if (config.legacy) headers.Authorization = `Bearer ${config.key}`;
    let response;
    try { response = await fetchImpl(new URL('/rest/v1/rpc/sync_pandascore_match', config.origin), { method: 'POST', headers, body: JSON.stringify({ p_fixture: fixture }), redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch { throw new SafeError('Sync response lost. The atomic RPC may have committed; the same fixture is safe to review and retry.'); }
    if (!response.ok) { try { await response.body?.cancel(); } catch {} throw new SafeError(`Fixture sync failed (HTTP ${response.status}). Check the migration and grants. Earlier fixtures may have committed.`); }
    let result;
    try { result = await response.json(); } catch { throw new SafeError('Sync response could not be verified. Inspect operations before retrying.'); }
    if (!result || typeof result.action !== 'string' || !result.match_id) throw new SafeError('Unexpected sync response. Inspect database operations.');
    log({ external_reference: fixture.external_reference, ...result });
    if (result.action === 'refunded_review_required') log('Review required: source schedule or opponent changed after purchases. Open positions were refunded; historical terms were preserved.');
  }
  return eligible;
}
if (require.main === module) run().catch(error => { console.error(error instanceof SafeError ? error.message : 'Sync stopped. Raw details suppressed to protect credentials.'); process.exitCode = 1; });
module.exports = { run };
