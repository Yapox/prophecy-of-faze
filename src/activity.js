const DAY = 86_400_000;
const dayNumber = value => Math.floor(Date.parse(value) / DAY);

export function activitySummary(data, now = Date.now()) {
  const today = Math.floor(now / DAY);
  const positions = data.positions.filter(position => Number.isFinite(Date.parse(position.created_at)) && Date.parse(position.created_at) <= now);
  const activeDays = new Set(positions.map(position => dayNumber(position.created_at)));
  const orderedDays = [...activeDays].sort((a, b) => a - b);
  let bestStreak = 0, run = 0, previous;
  for (const day of orderedDays) { run = day === previous + 1 ? run + 1 : 1; bestStreak = Math.max(bestStreak, run); previous = day; }
  let currentStreak = 0, cursor = activeDays.has(today) ? today : today - 1;
  while (activeDays.has(cursor)) { currentStreak++; cursor--; }
  const todayPositions = positions.filter(position => dayNumber(position.created_at) === today);
  const marketMap = new Map(data.markets.map(market => [market.id, market]));
  const todayMatches = new Set(todayPositions.map(position => marketMap.get(position.market_id)?.match_id).filter(Boolean));
  const resolved = data.markets.filter(market => market.status === 'resolved' && Date.parse(market.settled_at) <= now && positions.some(position => position.market_id === market.id))
    .sort((a, b) => Date.parse(b.settled_at) - Date.parse(a.settled_at) || String(a.id).localeCompare(String(b.id)));
  let winningStreak = 0;
  for (const market of resolved) {
    const profit = positions.filter(position => position.market_id === market.id).reduce((total, position) => total + Number(position.stake) * (position.side === market.winning_side ? 1 : -1), 0);
    if (profit <= 0) break;
    winningStreak++;
  }
  return {
    currentStreak, bestStreak, winningStreak, todayPredictions: todayPositions.length, todayMatches: todayMatches.size,
    nextReset: new Date((today + 1) * DAY).toISOString(),
    week: Array.from({ length: 7 }, (_, index) => {
      const day = today - 6 + index;
      return { date: new Date(day * DAY).toISOString().slice(0, 10), active: activeDays.has(day), today: day === today };
    }),
  };
}
