import { useEffect, useState } from 'react';
import { isConfigured } from './api.js';
import { formatCoins, marketIsOpen } from './domain.js';
import useArena from './useArena.js';
import MarketCard from './components/MarketCard.jsx';
import TradeDialog from './components/TradeDialog.jsx';
import AuthDialog from './components/AuthDialog.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Oracle from './pages/Oracle.jsx';
import Legal from './pages/Legal.jsx';

const pageNames = { home: 'Home', markets: 'Markets', portfolio: 'Portfolio', leaderboard: 'Leaderboard', oracle: 'The Oracle', terms: 'Terms of use', privacy: 'Privacy notice' };
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
  if (arena.mode === 'live' && !arena.authenticated) return <div className="empty-state"><h3>Sign in to see live FaZe matches.</h3><p>The connected backend requires an account to read published matches and prediction questions.</p><button className="button button-primary" onClick={onAuth}>Sign in to load matches</button></div>;
  if (arena.mode === 'live' && !arena.accountLoaded && arena.error) return <div className="empty-state"><h3>Match records could not be loaded.</h3><p>Use Retry refresh to reconnect to your account.</p></div>;
  return <EmptyMessage search={search} />;
}

export default function OdysseyApp() {
  const arena = useArena();
  const [page, setPage] = useState(currentPage);
  const [trade, setTrade] = useState(null);
  const [auth, setAuth] = useState(false);
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
  const matches = new Map(arena.data.matches.map(match => [match.id, match]));
  const markets = arena.data.markets.filter(market => matches.has(market.match_id));
  const featured = markets.find(market => marketIsOpen(market, matches.get(market.match_id), now)) || markets[0];
  const loading = arena.mode === 'live' && (!arena.ready || arena.authenticated && !arena.accountLoaded && !arena.error);
  const practice = () => { arena.setMode('demo'); setAuth(false); };
  const account = () => { if (isConfigured) arena.setMode('live'); if (!arena.session) setAuth(true); };
  function showTrade(id, side) {
    if (arena.mode === 'live' && !arena.authenticated) { setAuth(true); return; }
    if (!arena.accountLoaded) return;
    arena.setTradeMessage('');
    setTrade({ id: arena.pending?.args.p_market_id || id, side: arena.pending?.args.p_side || side });
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
      {['terms', 'privacy'].includes(page) ? <Legal page={page} /> : <>
        {page === 'home' ? <section className="hero"><div className="hero-copy"><span className="eyebrow">Your esports odyssey begins here</span><h1>Predict the Game.<br /><em>Become the Legend.</em></h1><p>Every match is a new crossing. Put your esports knowledge to the test with free virtual coins, follow your predictions, and chart your own journey to Ithaca.</p><div className="hero-actions"><a className="button button-primary" href="#markets">Enter the Arena</a><a className="button button-secondary" href="#portfolio">View portfolio</a></div><div className="hero-footnote">Inspired by Homer’s Odyssey. 1,000 free starting coins.</div></div><div className="hero-product"><span className="product-caption">Your next port of call</span>{loading ? <Loading /> : featured ? card(featured, true) : <Empty arena={arena} onAuth={account} />}</div></section> : <div className="page-heading"><span className="eyebrow">{({ markets: 'Choose your next crossing', portfolio: 'Chart your odyssey', leaderboard: 'A place among the legends', oracle: 'Seek the counsel of the Oracle' })[page]}</span><h1>{({ markets: 'Every match. Your call.', portfolio: 'Your portfolio.', leaderboard: 'The leaderboard.', oracle: 'The Oracle.' })[page]}</h1><p>{({ markets: 'Choose YES or NO. Each simulated contract costs 1 coin and returns 2 if your prediction is correct.', portfolio: 'Your virtual balance, open predictions, and simulated results, all in one place.', leaderboard: 'Follow simulated performance through wallet coins plus unsettled stakes.', oracle: 'Read the available match information before you make your prediction.' })[page]}</p></div>}
        <div className="mode-notice"><span>{arena.mode === 'demo' ? 'Practice arena. Sample fixtures and a browser-only wallet. Every trade and return is simulated.' : arena.authenticated ? `Account arena. Backend records refresh every 30 seconds while this tab is visible.${arena.updatedAt ? ` Last synced at ${new Date(arena.updatedAt).toLocaleTimeString()}.` : ''} Every return is simulated.` : 'Account arena. Sign in to load published matches from the connected backend.'}</span><button className="text-link" disabled={arena.busy} onClick={arena.mode === 'demo' ? account : practice}>{arena.mode === 'demo' ? 'Use account mode' : 'Try practice mode'}</button></div>
        {arena.error && <div className="notice notice-error" role="alert">{arena.error} {arena.authenticated && <button className="text-link" onClick={arena.refresh} disabled={arena.loading}>Retry refresh</button>}</div>}
        {arena.pending && <div className="pending-banner"><p>A purchase is awaiting confirmation. Retrying the same request will not debit your wallet twice.</p><button className="button button-secondary button-small" disabled={arena.busy} onClick={() => showTrade(arena.pending.args.p_market_id, arena.pending.args.p_side)}>Review purchase</button></div>}
        {page === 'home' && <><section className="section"><div className="section-heading"><div><span className="eyebrow">The next chapter</span><h2>On the horizon.</h2></div><a className="text-link" href="#markets">Explore all markets</a></div>{loading ? <Loading /> : markets.some(market => market.status === 'open') ? <div className="market-grid">{markets.filter(market => market.status === 'open').slice(0, 2).map(market => card(market))}</div> : <Empty arena={arena} onAuth={account} />}<p className="sample-warning">{arena.sample ? 'Fixtures, event names, and schedules are illustrative. No live esports feed is connected.' : 'Match records are published by the project backend.'}</p></section><section className="how-section"><div className="how-art"><span className="eyebrow">From the first crossing to Ithaca</span><Voyage /><p>Every legend starts with a journey.</p></div><div className="how-content"><span className="eyebrow">Find your way</span><h2>A little foresight.<br />An odyssey of your own.</h2>{[['I', 'Choose your crossing', 'Explore Counter-Strike 2 and Valorant predictions. Read the question and check when purchases close.'], ['II', 'Make your call', 'Select YES or NO. Review the number of contracts, cost, and possible simulated return before you confirm.'], ['III', 'Chart your progress', 'Follow each result in your portfolio. A correct prediction returns 2 virtual coins per contract.']].map(([number, title, text]) => <div className="how-step" key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}</div></section></>}
        {page === 'markets' && <section className="section markets-section"><div className="market-toolbar"><div className="filter-tabs" role="group" aria-label="Filter by game">{['All games', 'CS2', 'Valorant'].map(value => <button key={value} aria-pressed={game === value} onClick={() => setGame(value)}>{value}</button>)}</div><label className="search-field"><span className="sr-only">Search teams or events</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search teams or events" /></label></div><div className="status-row"><label className="checkbox-label"><input type="checkbox" checked={settled} onChange={event => setSettled(event.target.checked)} /> Include settled markets</label>{arena.authenticated && <button className="text-link" onClick={arena.refresh} disabled={arena.loading}>Refresh markets</button>}</div><p className="market-count">{visible.length} {visible.length === 1 ? 'market' : 'markets'} / {arena.sample ? 'sample fixtures' : 'account records'}</p>{loading ? <Loading /> : visible.length ? <div className="market-grid">{visible.map(market => card(market))}</div> : <Empty arena={arena} onAuth={account} search={Boolean(game !== 'All games' || search)} />}</section>}
        {['portfolio', 'leaderboard'].includes(page) && <div className="status-row"><p>{arena.mode === 'demo' ? 'Practice data stays in this browser.' : 'Account balances and returns use simulated virtual coins.'}</p>{arena.authenticated && <button className="button button-secondary button-small" onClick={arena.refresh} disabled={arena.loading}>{arena.loading ? 'Refreshing…' : 'Refresh'}</button>}</div>}
        {loading && ['portfolio', 'leaderboard', 'oracle'].includes(page) ? <Loading /> : <>{page === 'portfolio' && <Portfolio arena={arena} onAuth={() => setAuth(true)} />}{page === 'leaderboard' && <Leaderboard arena={arena} onAuth={() => setAuth(true)} />}{page === 'oracle' && <Oracle arena={arena} selectedMarket={oracleMarket} onSelect={setOracleMarket} onAuth={account} />}</>}
      </>}
    </main>
    <footer className="site-footer"><div className="footer-inner"><div><a className="footer-brand" href="#home">Prophecy of FaZe</a><p>An unofficial HackUTA 2026 prototype for the FaZe Clan sponsor challenge. No endorsement is implied. All predictions and returns use simulated virtual currency with no cash value.</p></div><nav className="footer-links" aria-label="Legal"><a href="#terms">Terms of use</a><a href="#privacy">Privacy notice</a></nav></div><div className="footer-bottom">NO DEPOSITS. NO WITHDRAWALS. NO CASH REWARDS.</div></footer>
    {trade && selected && arena.accountLoaded && <TradeDialog key={`${arena.mode}:${selected.id}`} market={selected} match={matches.get(selected.match_id)} initialSide={trade.side} arena={arena} now={now} onClose={() => setTrade(null)} onPortfolio={() => { setTrade(null); window.location.hash = 'portfolio'; }} />}
    {auth && <AuthDialog onClose={() => setAuth(false)} onPractice={practice} />}
  </>;
}

function Voyage() {
  return <svg className="temple-engraving" viewBox="0 0 440 280" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="1.3"><path d="M64 194H371L346 218H109L79 205ZM218 194V50L146 174H217ZM226 61L302 173H226M217 50L238 46L217 37M78 184L61 174M355 190L385 174" /><path d="M102 219L82 239M133 218L113 239M164 218L144 239M195 218L175 239M226 218L206 239M257 218L237 239M288 218L268 239M319 218L299 239M72 252C103 240 121 261 151 251S198 261 229 251S275 261 306 251S352 258 378 248M109 265C141 257 164 272 194 264S246 271 277 263S319 269 345 262M55 132L71 105L87 132M354 89L374 53L394 89M54 140H90M351 97H396" /></g></svg>;
}
