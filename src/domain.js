export const INITIAL_BALANCE = 1000;
export const CONTRACT_COST = 1;
export const CONTRACT_PAYOUT = 2;
export const PRACTICE_KEY = 'prophecy-faze-practice-v1';

export function createPractice(now = Date.now()) {
  const matches = [
    ['cs2-navi', 'CS2', 'NAVI', 'Olympus Invitational', 6, 'Best of 3'],
    ['valorant-sentinels', 'Valorant', 'Sentinels', 'Aegis Exhibition', 10, 'Best of 3'],
    ['cs2-vitality', 'CS2', 'Team Vitality', 'Olympus Invitational', 26, 'Best of 3'],
    ['valorant-g2', 'Valorant', 'G2 Esports', 'Aegis Exhibition', 30, 'Best of 3'],
  ].map(([id, game, opponent, event_name, hours, format]) => ({
    id, game, opponent, event_name, format, faze_team: 'FaZe Clan',
    starts_at: new Date(now + hours * 3600000).toISOString(),
  }));
  return {
    version: 1, user: { id: 'practice-user', display_name: 'You' },
    matches,
    markets: matches.map(match => ({
      id: `market-${match.id}`, match_id: match.id,
      question: `Will FaZe Clan beat ${match.opponent}?`,
      closes_at: new Date(new Date(match.starts_at).getTime() - 300000).toISOString(),
      status: 'open', winning_side: null, settled_at: null,
    })),
    wallet: { balance: INITIAL_BALANCE }, positions: [],
    history: [{ id: 'practice-welcome', kind: 'signup_bonus', amount: INITIAL_BALANCE, balance_after: INITIAL_BALANCE, created_at: new Date(now).toISOString() }],
  };
}

export function marketIsOpen(market, match, now = Date.now()) {
  return Boolean(market && match && market.status === 'open' &&
    now < Date.parse(market.closes_at) && now < Date.parse(match.starts_at));
}

export function tradePreview(contracts) {
  const count = Number(contracts);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000_000_000) {
    throw new Error('Enter a whole number from 1 to 1,000,000,000.');
  }
  return { contracts: count, cost: count * CONTRACT_COST, payout: count * CONTRACT_PAYOUT, profit: count * (CONTRACT_PAYOUT - CONTRACT_COST) };
}

export function purchasePractice(state, intent, now = Date.now()) {
  if (intent.userId !== state.user.id) throw new Error('This purchase belongs to a different wallet.');
  const { p_market_id: marketId, p_side: side, p_stake: stake, p_request_id: requestId } = intent.args;
  if (!requestId || !['YES', 'NO'].includes(side)) throw new Error('Choose an outcome and a valid request ID.');
  const existing = state.positions.find(position => position.request_id === requestId);
  if (existing) {
    if (existing.market_id !== marketId || existing.side !== side || Number(existing.stake) !== stake) {
      throw new Error('Request ID already used with different purchase parameters');
    }
    return state;
  }
  tradePreview(stake);
  const market = state.markets.find(item => item.id === marketId);
  const match = state.matches.find(item => item.id === market?.match_id);
  if (!marketIsOpen(market, match, now)) throw new Error('This market is closed.');
  if (stake > state.wallet.balance) throw new Error('You do not have enough virtual coins.');
  const balance = state.wallet.balance - stake;
  const position = { id: `position-${requestId}`, user_id: state.user.id, market_id: marketId, side, stake, request_id: requestId, created_at: new Date(now).toISOString() };
  return {
    ...state, wallet: { balance }, positions: [position, ...state.positions],
    history: [{ id: `debit-${requestId}`, position_id: position.id, kind: 'prediction_purchase', amount: -stake, balance_after: balance, created_at: position.created_at }, ...state.history],
  };
}

export function settlePractice(state, marketId, side, now = Date.now()) {
  if (![null, 'YES', 'NO'].includes(side)) throw new Error('Choose a valid practice result.');
  const market = state.markets.find(item => item.id === marketId);
  if (!market) throw new Error('Market not found.');
  if (market.status !== 'open') {
    if (market.winning_side === side) return state;
    throw new Error('This market already has a different result.');
  }
  let balance = Number(state.wallet.balance);
  const credits = [];
  for (const position of state.positions.filter(item => item.market_id === marketId)) {
    const amount = side === null ? Number(position.stake) : position.side === side ? Number(position.stake) * CONTRACT_PAYOUT : 0;
    if (!amount) continue;
    balance += amount;
    credits.unshift({ id: `credit-${position.id}`, position_id: position.id, kind: side === null ? 'prediction_refund' : 'prediction_payout', amount, balance_after: balance, created_at: new Date(now).toISOString() });
  }
  return {
    ...state, wallet: { balance }, history: [...credits, ...state.history],
    markets: state.markets.map(item => item.id === marketId ? { ...item, status: side === null ? 'cancelled' : 'resolved', winning_side: side, settled_at: new Date(now).toISOString() } : item),
  };
}

export function portfolioSummary(state) {
  const marketMap = new Map(state.markets.map(market => [market.id, market]));
  let committed = 0, realized = 0, possiblePayout = 0, settledCount = 0, wins = 0;
  for (const position of state.positions) {
    const market = marketMap.get(position.market_id);
    const stake = Number(position.stake);
    if (!market || market.status === 'open') { committed += stake; possiblePayout += stake * CONTRACT_PAYOUT; }
    else if (market.status === 'resolved') {
      settledCount++;
      if (market.winning_side === position.side) { realized += stake; wins++; }
      else realized -= stake;
    }
  }
  return { balance: Number(state.wallet.balance), committed, total: Number(state.wallet.balance) + committed, realized, possiblePayout, settledCount, wins };
}

export function progression(total) {
  if (total >= 5000) return 'Legend of Ithaca';
  if (total >= 2500) return 'Captain';
  if (total >= 1500) return 'Navigator';
  return 'Wayfarer';
}

export function loadPractice(storage, now = Date.now()) {
  try {
    const data = JSON.parse(storage?.getItem(PRACTICE_KEY) || 'null');
    if (data?.version === 1 && Number.isSafeInteger(data.wallet?.balance) && data.wallet.balance >= 0 &&
      Array.isArray(data.matches) && Array.isArray(data.markets) && Array.isArray(data.positions) && Array.isArray(data.history) && data.user?.id === 'practice-user') return data;
  } catch { /* Unavailable or invalid browser storage starts a fresh practice wallet. */ }
  return createPractice(now);
}

export const formatCoins = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value || 0));
export const formatTime = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
