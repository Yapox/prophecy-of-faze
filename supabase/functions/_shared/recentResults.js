const clean = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const id = value => Number.isSafeInteger(value) && value > 0;

export function summarizeResults(records, opponentName, now = Date.now()) {
  const valid = [];
  const unique = new Map(), conflicting = new Set();
  for (const row of records) {
    if (!id(row?.id) || conflicting.has(row.id)) continue;
    if (unique.has(row.id) && JSON.stringify(unique.get(row.id)) !== JSON.stringify(row)) { unique.delete(row.id); conflicting.add(row.id); }
    else unique.set(row.id, row);
  }
  for (const row of unique.values()) {
    const teams = Array.isArray(row?.opponents) ? row.opponents.map(entry => entry?.type === 'Team' ? entry.opponent : null) : null;
    if (row.status !== 'finished' || row.draw !== false || row.forfeit !== false || row.rescheduled === true || row.complete === false || !Number.isFinite(Date.parse(row.end_at)) || Date.parse(row.end_at) > now || !Array.isArray(teams) || teams.length !== 2 || teams.some(team => !id(team?.id) || !team.name) || teams[0].id === teams[1].id || !teams.some(team => team.id === row.winner_id)) continue;
    if (row.winner?.id != null && row.winner.id !== row.winner_id) continue;
    if (!Array.isArray(row.results) || row.results.length !== 2 || new Set(row.results.map(result => result.team_id)).size !== 2 || row.results.some(result => !teams.some(team => team.id === result.team_id) || !Number.isSafeInteger(result.score) || result.score < 0)) continue;
    const winner = row.results.find(result => result.team_id === row.winner_id);
    const loser = row.results.find(result => result.team_id !== row.winner_id);
    if (winner.score <= loser.score) continue;
    valid.push({ ...row, teams });
  }
  valid.sort((a, b) => Date.parse(b.end_at) - Date.parse(a.end_at) || b.id - a.id);
  return [{ name: 'FaZe Clan', providerTeamId: 3212 }, { name: opponentName }].map(target => {
    const identities = new Set(valid.flatMap(row => row.teams.filter(team => target.providerTeamId ? team.id === target.providerTeamId && ['faze', 'faze clan'].includes(clean(team.name)) : clean(team.name) === clean(target.name)).map(team => team.id)));
    const teamId = identities.size === 1 ? [...identities][0] : null;
    const results = teamId ? valid.filter(row => row.teams.some(team => team.id === teamId)).slice(0, 5).map(row => ({
      providerMatchId: row.id, endedAt: row.end_at, opponent: row.teams.find(team => team.id !== teamId).name,
      won: row.winner_id === teamId,
      scoreFor: row.results.find(result => result.team_id === teamId).score,
      scoreAgainst: row.results.find(result => result.team_id !== teamId).score,
    })) : [];
    return { name: target.name, providerTeamId: teamId, wins: results.filter(result => result.won).length, played: results.length, results };
  });
}

export function createRecentResultsReader({ fetchImpl = fetch, clock = Date.now } = {}) {
  let cached, inFlight;
  return async function recentResults(match, token) {
    const unavailable = reason => ({ available: false, reason });
    if (match.game !== 'CS2' || !/^pandascore:match:[1-9]\d*$/.test(match.external_reference || '')) return unavailable('Recent results are available only for imported PandaScore CS2 fixtures.');
    if (!token) return unavailable('PandaScore recent results are not configured on the server.');
    try {
      if (!cached || cached.expires <= clock()) {
        inFlight ||= (async () => {
          const records = [];
          // A bounded sample, never presented as complete team history.
          for (let page = 1; page <= 2; page++) {
            const url = new URL('https://api.pandascore.co/csgo/matches/past');
            url.searchParams.set('page[number]', String(page));
            url.searchParams.set('page[size]', '100');
            url.searchParams.set('sort', '-begin_at,-id');
            const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(6000) });
            if (!response.ok) throw new Error('Provider unavailable');
            const data = await response.json();
            if (!Array.isArray(data) || data.length > 100) throw new Error('Invalid provider records');
            records.push(...data);
            if (data.length < 100 || response.headers?.get('x-rate-limit-remaining') === '0') break;
          }
          return { records, checkedAt: new Date(clock()).toISOString(), expires: clock() + 300_000 };
        })();
        try { cached = await inFlight; } finally { inFlight = null; }
      }
      return { available: true, provider: 'PandaScore', checkedAt: cached.checkedAt, scannedMatches: cached.records.length,
        scope: 'Up to five validated results per team found within a bounded sample of recent CS2 fixtures. This may omit matches and is not a complete form record or a win probability.',
        teams: summarizeResults(cached.records, match.opponent, clock()), playerStats: 'Player performance statistics are not supplied by this integration.' };
    } catch { return unavailable('PandaScore results could not be loaded. No performance statistics were inferred.'); }
  };
}
