import { useEffect, useState } from 'react';
import { isConfigured } from './api.js';
import { formatCoins } from './domain.js';
import useArena from './useArena.js';
import MarketCard from './components/MarketCard.jsx';
import TradeDialog from './components/TradeDialog.jsx';
import AuthDialog from './components/AuthDialog.jsx';
import GitHubProfile from './components/GitHubProfile.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Oracle from './pages/Oracle.jsx';
import CinematicLanding from './pages/CinematicLanding.jsx';
import { clearRecoveryLocation, recoveryRequested } from './auth.js';

const pageNames = { home: 'Home', markets: 'Markets', portfolio: 'Portfolio', leaderboard: 'Leaderboard', oracle: 'The Oracle' };
function currentPage() {
  const hash = typeof window === 'undefined' ? 'home' : window.location.hash.slice(1);
  return Object.hasOwn(pageNames, hash) ? hash : 'home';
}
function Loading() {
  return <div className="skeleton-grid" role="status" aria-label="Loading account records">{[0, 1].map(id => <div className="skeleton-card skeleton" key={id}><div className="skeleton-line short" /><div className="skeleton-block" /><div className="skeleton-line" /></div>)}</div>;
}
function EmptyMessage({ search = false }) {
  return <div className="empty-state"><h3>{search ? 'No matching predictions.' : 'The next match is on its way.'}</h3><p>{search ? 'Try a different game or search term.' : 'There are no published matches to display yet.'}</p></div>;
}
function Empty({ arena, onAuth, search = false }) {
  if (arena.mode === 'live' && !arena.authenticated) return <div className="empty-state"><h3>Sign in to see live FaZe matches.</h3><button className="button button-primary" onClick={onAuth}>Sign in to load matches</button></div>;
  if (arena.mode === 'live' && !arena.accountLoaded && arena.error) return <div className="empty-state"><h3>Match records could not be loaded.</h3><p>Use Retry refresh to reconnect to your account.</p></div>;
  return <EmptyMessage search={search} />;
}

export default function OdysseyApp() {
  const arena = useArena();
  const [page, setPage] = useState(currentPage);
  const [trade, setTrade] = useState(null);
  const [auth, setAuth] = useState(recoveryRequested);
  const [oracleMarket, setOracleMarket] = useState('');
  const [game, setGame] = useState('All games');
  const [search, setSearch] = useState('');
  const [settled, setSettled] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const navigate = () => setPage(currentPage());
    window.addEventListener('hashchange', navigate);
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => { window.removeEventListener('hashchange', navigate); window.clearInterval(timer); };
  }, []);
  useEffect(() => { document.title = `${pageNames[page]} | Prophecy of FaZe`; window.scrollTo({ top: 0, behavior: 'auto' }); }, [page]);
  useEffect(() => { setTrade(null); }, [arena.mode, arena.session?.user.id]);
  useEffect(() => { if (arena.recovering) { setTrade(null); setAuth(true); } }, [arena.recovering]);
  const matches = new Map(arena.data.matches.map(match => [match.id, match]));
  const markets = arena.data.markets.filter(market => matches.has(market.match_id));
  const loading = arena.mode === 'live' && (!arena.ready || arena.authenticated && !arena.accountLoaded && !arena.error);
  const practice = () => { arena.setMode('demo'); setAuth(false); };
  const account = () => { if (isConfigured) arena.setMode('live'); if (!arena.session) setAuth(true); };
  function showTrade(id, side, quantity = 100) {
    if (arena.mode === 'live' && !arena.authenticated) { setAuth(true); return; }
    if (!arena.accountLoaded) return;
    arena.setTradeMessage('');
    setTrade({ id: arena.pending?.args.p_market_id || id, side: arena.pending?.args.p_side || side, quantity });
  }
  function showOracle(id) { setOracleMarket(id); window.location.hash = 'oracle'; }
  const card = (market, featuredCard = false) => <MarketCard key={market.id} market={market} match={matches.get(market.match_id)} sample={arena.sample} featured={featuredCard} now={now} onTrade={showTrade} onOracle={showOracle} />;
  const selected = markets.find(market => market.id === trade?.id);
  const visible = markets.filter(market => {
    const match = matches.get(market.match_id);
    return (game === 'All games' || (game === 'CS2' ? /CS2|Counter-Strike/i.test(match.game) : /Valorant/i.test(match.game))) &&
      (settled || market.status === 'open') && `${market.question} ${match.event_name}`.toLowerCase().includes(search.trim().toLowerCase());
  });

  return <>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content').focus(); }}>Skip to content</a>
    <div className="utility-bar"><div className="utility-inner"><span>HackUTA 2026 / Unofficial prototype</span><span>Virtual coins. Simulated returns.</span></div></div>
    <header className="site-header"><a className="brand" href="#home"><span className="brand-monogram" aria-hidden="true">P</span><span className="brand-name">Prophecy of FaZe</span></a><nav className="main-nav" aria-label="Main navigation">{['markets', 'portfolio', 'leaderboard', 'oracle'].map(value => <a key={value} href={`#${value}`} aria-current={page === value ? 'page' : undefined}>{pageNames[value]}</a>)}</nav><div className="header-actions">{arena.accountLoaded && <a href="#portfolio" className="wallet-pill">{formatCoins(arena.data.wallet.balance)} coins<small>{arena.mode === 'demo' ? 'Practice wallet' : 'Virtual balance'}</small></a>}{arena.authenticated ? <button className="button button-secondary button-small" disabled={arena.busy} onClick={arena.signOut}>Sign out</button> : <button className="button button-primary button-small" onClick={account}>Sign in</button>}</div></header>
    {arena.notice && <div className="notice global-notice" role="status">{arena.notice} <button className="text-link" onClick={() => arena.setNotice('')}>Dismiss</button></div>}
    <main className="main-content" id="main-content" tabIndex="-1">
        {page !== 'home' && <div className="page-heading"><span className="eyebrow">{({ markets: 'Choose your next crossing', portfolio: 'Chart your odyssey', leaderboard: 'A place among the legends', oracle: 'Seek the counsel of the Oracle' })[page]}</span><h1>{({ markets: 'Every match. Your call.', portfolio: 'Your portfolio.', leaderboard: 'The leaderboard.', oracle: 'The Oracle.' })[page]}</h1><p>{({ markets: '1 virtual coin per contract. 2 back if correct.', portfolio: 'Your calls. Your coins. Your progress.', leaderboard: 'Make your call. Climb the ranks.', oracle: 'Match insight before your next move.' })[page]}</p></div>}
        <div className="mode-notice"><span>{arena.mode === 'demo' ? 'Practice mode · Sample matches · Saved on this device' : arena.authenticated ? `Account mode${arena.updatedAt ? ` · Updated ${new Date(arena.updatedAt).toLocaleTimeString()}` : ''}` : 'Explore the arena with free virtual coins.'}</span><button className="text-link" disabled={arena.busy} onClick={arena.mode === 'demo' ? account : practice}>{arena.mode === 'demo' ? 'Use account mode' : 'Try practice mode'}</button></div>
        {arena.error && <div className="notice notice-error" role="alert">{arena.error} {arena.authenticated && <button className="text-link" onClick={arena.refresh} disabled={arena.loading}>Retry refresh</button>}</div>}
        {arena.pending && <div className="pending-banner"><p>A purchase is awaiting confirmation. Retrying the same request will not debit your wallet twice.</p><button className="button button-secondary button-small" disabled={arena.busy} onClick={() => showTrade(arena.pending.args.p_market_id, arena.pending.args.p_side)}>Review purchase</button></div>}
        {page === 'home' && <CinematicLanding arena={arena} markets={markets} matches={matches} now={now} onAccount={account} onTrade={showTrade} onOracle={showOracle} loading={loading} loadingContent={<Loading />} emptyContent={<Empty arena={arena} onAuth={account} />} />}
        {page === 'markets' && <section className="section markets-section"><div className="market-toolbar"><div className="filter-tabs" role="group" aria-label="Filter by game">{['All games', 'CS2', 'Valorant'].map(value => <button key={value} aria-pressed={game === value} onClick={() => setGame(value)}>{value}</button>)}</div><label className="search-field"><span className="sr-only">Search teams or events</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search teams or events" /></label></div><div className="status-row"><label className="checkbox-label"><input type="checkbox" checked={settled} onChange={event => setSettled(event.target.checked)} /> Include settled markets</label>{arena.authenticated && <button className="text-link" onClick={arena.refresh} disabled={arena.loading}>Refresh markets</button>}</div><p className="market-count">{visible.length} {visible.length === 1 ? 'market' : 'markets'} / {arena.sample ? 'sample fixtures' : 'account records'}</p>{loading ? <Loading /> : visible.length ? <div className="market-grid">{visible.map(market => card(market))}</div> : <Empty arena={arena} onAuth={account} search={Boolean(game !== 'All games' || search)} />}</section>}
        {['portfolio', 'leaderboard'].includes(page) && arena.authenticated && <div className="status-row"><button className="button button-secondary button-small" onClick={arena.refresh} disabled={arena.loading}>{arena.loading ? 'Refreshing…' : 'Refresh'}</button></div>}
        {loading && ['portfolio', 'leaderboard', 'oracle'].includes(page) ? <Loading /> : <>{page === 'portfolio' && <Portfolio arena={arena} onAuth={() => setAuth(true)} />}{page === 'leaderboard' && <Leaderboard arena={arena} now={now} onAuth={() => setAuth(true)} />}{page === 'oracle' && <Oracle arena={arena} selectedMarket={oracleMarket} onSelect={setOracleMarket} onAuth={account} />}</>}
    </main>
    <footer className="site-footer">
      <div className="footer-inner">
        <div><a className="footer-brand" href="#home">Prophecy of FaZe</a><p>Built for HackUTA 2026.</p></div>
        <div className="footer-credit"><p>© 2026 <GitHubProfile name="Aashaswa Khakurel" username="Yapox" /> <span className="footer-creator-pair">&amp; Subigya Poudel.</span></p><p>All rights reserved.</p></div>
      </div>
      <div className="footer-bottom">SIMULATED COINS ONLY · NO CASH VALUE</div>
    </footer>
    {trade && selected && arena.accountLoaded && <TradeDialog key={`${arena.mode}:${selected.id}`} market={selected} match={matches.get(selected.match_id)} initialSide={trade.side} initialQuantity={trade.quantity} arena={arena} now={now} onClose={() => setTrade(null)} onPortfolio={() => { setTrade(null); window.location.hash = 'portfolio'; }} />}
    {auth && <AuthDialog key={arena.recovering ? 'recovery' : 'auth'} initialMode={arena.recovering ? 'recovery' : recoveryRequested() ? 'forgot' : 'login'} onClose={() => { setAuth(false); arena.finishRecovery(); clearRecoveryLocation(); }} onPractice={practice} onRecoveryComplete={() => { arena.finishRecovery(); clearRecoveryLocation(); arena.setNotice('Your password has been updated. You are signed in to your account.'); setAuth(false); }} />}
  </>;
}
