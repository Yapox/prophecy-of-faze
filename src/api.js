import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const isConfigured = Boolean(url && key?.startsWith('sb_publishable_'));
export const supabase = isConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

async function allRows(table, columns, userId) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    let query = supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + 499);
    if (userId) query = query.eq('user_id', userId);
    const page = unwrap(await query);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Authentication required');
  return data.user;
}

export async function loadDashboard() {
  const user = await requireUser();
  const [matches, markets, wallet, positions, history, leaderboard] = await Promise.all([
    allRows('matches', 'id,game,event_name,faze_team,opponent,starts_at,external_reference,created_at'),
    allRows('prediction_markets', 'id,match_id,question,closes_at,status,winning_side,settled_at,created_at'),
    supabase.from('wallets').select('user_id,balance,updated_at').eq('user_id', user.id).single().then(unwrap),
    allRows('prediction_positions', 'id,user_id,market_id,side,stake,request_id,created_at', user.id),
    allRows('wallet_transactions', 'id,user_id,position_id,kind,amount,balance_after,created_at', user.id),
    supabase.rpc('get_leaderboard', { p_limit: 50 }).then(unwrap),
  ]);
  matches.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  positions.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  history.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return { user, matches, markets, wallet, positions, history, leaderboard };
}

export function createPurchaseIntent(userId, marketId, side, stake) {
  if (!['YES', 'NO'].includes(side)) throw new Error('Choose YES or NO.');
  if (!Number.isSafeInteger(stake) || stake < 1 || stake > 1_000_000_000) {
    throw new Error('Enter a whole-coin stake from 1 to 1,000,000,000.');
  }
  return {
    userId,
    args: { p_market_id: marketId, p_side: side, p_stake: stake, p_request_id: crypto.randomUUID() },
  };
}

export async function submitPurchase(intent) {
  const user = await requireUser();
  if (user.id !== intent.userId) throw new Error('Account changed. Do not replay this purchase.');
  const data = unwrap(await supabase.rpc('purchase_prediction', intent.args));
  const position = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!position || Array.isArray(position) || !position.id ||
      position.user_id !== user.id || position.request_id !== intent.args.p_request_id) {
    throw new Error('Purchase response could not be verified. Retry with the same request ID.');
  }
  return position;
}

const purchaseMessages = {
  'Authentication required': 'Please sign in to continue.',
  'Insufficient virtual coins': 'You do not have enough virtual coins.',
  'Market is closed': 'This market has closed.',
  'Match has already started': 'Predictions have closed for this match.',
  'Market not found': 'This market is unavailable. Refresh the list.',
  'Wallet not found': 'Your wallet is unavailable. Contact the team.',
  'Request ID already used with different purchase parameters': 'This request ID belongs to another purchase.',
  'Valid market, side, whole-coin stake and request ID required': 'Check the market, side, and whole-coin stake.',
};

export function purchaseError(error) {
  if (error?.code === 'P0001' && purchaseMessages[error.message]) {
    return { message: purchaseMessages[error.message], definitive: true };
  }
  return { message: 'The purchase outcome is uncertain. Retry the same request; it will not charge you twice.', definitive: false };
}

export async function askOracle(marketId, message, history = [], { signal } = {}) {
  if (!supabase) throw new Error('Account mode is not configured.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in to use The Oracle.');
  const response = await fetch('/api/oracle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ marketId, message, history }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The Oracle endpoint is unavailable. Run the Vercel server or deploy the project with server environment variables.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The Oracle could not respond. Please try again.');
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('The Oracle returned an empty reply. Please try again.');
  return result;
}
