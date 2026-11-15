import { useCallback, useEffect, useRef, useState } from 'react';
import { createPurchaseIntent, isConfigured, loadDashboard, purchaseError, submitPurchase, supabase } from './api.js';
import { createPractice, loadPractice, PRACTICE_KEY, purchasePractice, settlePractice } from './domain.js';

const pendingKey = id => `faze-pending-purchase:${id}`;
function browserStorage() { try { return window.localStorage; } catch { return null; } }
// A saved practice preference must not hide the connected backend on return.
function initialMode() { return isConfigured ? 'live' : 'demo'; }
function storedPending(id) {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(pendingKey(id)) || 'null');
    return parsed?.userId === id && parsed?.args?.p_request_id ? parsed : null;
  } catch { return null; }
}

export default function useArena() {
  const [mode, setModeState] = useState(initialMode);
  const [practice, setPractice] = useState(() => loadPractice(browserStorage()));
  const [session, setSession] = useState(null);
  const [recovering, setRecovering] = useState(false);
  const [ready, setReady] = useState(!isConfigured);
  const [accountData, setAccountData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingState, setPendingState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tradeMessage, setTradeMessage] = useState('');
  const identity = useRef({ mode, id: null });
  const operation = useRef(false);
  const practiceRef = useRef(practice);
  const requestGeneration = useRef(0);
  const refreshesInFlight = useRef(0);
  const userId = session?.user.id || null;
  identity.current.mode = mode;
  const data = mode === 'demo' ? practice : userId && accountData?.user.id === userId ? accountData
    : { user: { id: userId }, matches: [], markets: [], wallet: { balance: 0 }, positions: [], history: [], leaderboard: [] };
  const pending = mode === 'live' && pendingState?.userId === userId ? pendingState : null;

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') { setRecovering(true); setModeState('live'); identity.current.mode = 'live'; }
      if (event === 'SIGNED_OUT') setRecovering(false);
      const nextId = next?.user.id || null;
      if (identity.current.id !== nextId) {
        identity.current.id = nextId;
        requestGeneration.current++;
        setAccountData(null); setUpdatedAt(null); setPendingState(null); setError(''); setTradeMessage(''); setLoading(false);
        if (nextId && event === 'SIGNED_IN') {
          identity.current.mode = 'live';
          setModeState('live');
        }
      }
      setSession(next); setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async (options = {}) => {
    if (mode !== 'live' || !userId) return;
    if (options.background && refreshesInFlight.current) return;
    const generation = ++requestGeneration.current;
    refreshesInFlight.current++;
    setLoading(true); setError('');
    try {
      const result = await loadDashboard();
      if (generation === requestGeneration.current && identity.current.id === userId && identity.current.mode === 'live') {
        setAccountData(result); setUpdatedAt(Date.now());
      }
    } catch {
      if (generation === requestGeneration.current) setError('Account data could not be refreshed. Check your connection and try again. A confirmed purchase remains confirmed.');
    } finally {
      refreshesInFlight.current--;
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [mode, userId]);

  useEffect(() => { if (userId) setPendingState(storedPending(userId)); }, [userId]);
  useEffect(() => { if (mode === 'live' && userId) refresh(); }, [mode, userId, refresh]);
  useEffect(() => {
    if (mode !== 'live' || !userId) return;
    const sync = () => {
      if (document.visibilityState !== 'hidden') refresh({ background: true });
    };
    // The backend does not publish Realtime events. Re-read its authoritative
    // records while visible, on returning to the tab, and after reconnecting.
    const timer = window.setInterval(sync, 30_000);
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [mode, userId, refresh]);

  function setMode(next) {
    if (operation.current) return;
    identity.current.mode = next; requestGeneration.current++;
    setModeState(next); setTradeMessage(''); setError(''); setLoading(false);
  }

  function commitPractice(next) {
    const storage = browserStorage();
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(PRACTICE_KEY, JSON.stringify(next));
    } catch { setNotice('Browser storage is unavailable. This practice wallet will last for this page session only.'); }
    practiceRef.current = next; setPractice(next);
  }

  async function purchase(marketId, side, count, retry) {
    if (operation.current) return false;
    operation.current = true; setBusy(true); setTradeMessage('');
    const owner = mode === 'demo' ? 'practice-user' : userId;
    let intent;
    try {
      if (mode === 'live' && (!owner || !accountData)) throw new Error('Sign in and load your wallet before purchasing.');
      intent = retry || (mode === 'live' ? storedPending(owner) : null) || createPurchaseIntent(owner, marketId, side, count);
      if (mode === 'demo') {
        commitPractice(purchasePractice(practiceRef.current, intent));
        setNotice('Practice prediction placed. Your simulated portfolio is updated.');
        return true;
      }
      if (!retry) {
        // Persist before sending. If this fails, no request is submitted.
        window.sessionStorage.setItem(pendingKey(owner), JSON.stringify(intent));
        setPendingState(intent);
      }
      await submitPurchase(intent);
      try { window.sessionStorage.removeItem(pendingKey(owner)); } catch { /* Replaying the same intent remains safe. */ }
      if (identity.current.id === owner) setPendingState(null);
      if (identity.current.id !== owner || identity.current.mode !== 'live') return false;
      setNotice('Prediction confirmed. Your account wallet and portfolio are refreshing.');
      await refresh();
      return true;
    } catch (cause) {
      if (mode === 'demo' || !intent || !pendingState && !storedPending(owner)) setTradeMessage(cause.message || 'The prediction could not be submitted.');
      else {
        const result = purchaseError(cause);
        if (result.definitive) {
          try { window.sessionStorage.removeItem(pendingKey(owner)); } catch { /* No elevated retry. */ }
          setPendingState(null);
        }
        if (identity.current.id === owner) setTradeMessage(result.message);
      }
      return false;
    } finally { operation.current = false; setBusy(false); }
  }

  function resolvePractice(marketId, side) {
    try { commitPractice(settlePractice(practiceRef.current, marketId, side)); setNotice('Practice result applied. Simulated payouts and portfolio totals are updated.'); }
    catch (cause) { setError(cause.message); }
  }

  function resetPractice() {
    if (operation.current) return;
    commitPractice(createPractice()); setNotice('Practice wallet reset to 1,000 free virtual coins.');
  }

  async function signOut() {
    if (operation.current) return;
    const { error: cause } = await supabase.auth.signOut({ scope: 'local' });
    if (cause) setError('Sign-out failed. Please try again.');
  }

  return { mode, setMode, data, session, recovering, finishRecovery: () => setRecovering(false), ready, loading, updatedAt, error, notice, setNotice, pending, busy,
    tradeMessage, setTradeMessage, refresh, purchase, resolvePractice, resetPractice, signOut,
    authenticated: mode === 'live' && Boolean(userId), accountLoaded: mode === 'demo' || Boolean(accountData?.user.id === userId && userId),
    sample: mode === 'demo' };
}
