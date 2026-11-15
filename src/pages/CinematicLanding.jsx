import { useState } from 'react';
import { LazyMotion, domAnimation } from 'motion/react';
import OdysseyChapter from '../components/OdysseyChapter.jsx';
import MarketCard from '../components/MarketCard.jsx';
import { formatCoins, marketIsOpen, portfolioSummary, tradePreview } from '../domain.js';

function TradeCalculator({ arena, markets, matches, now, onTrade, onAccount }) {
  const [marketId, setMarketId] = useState('');
  const [side, setSide] = useState('YES');
  const [quantity, setQuantity] = useState('100');
  const market = markets.find(item => item.id === marketId) || markets.find(item => marketIsOpen(item, matches.get(item.match_id), now)) || markets[0];
  const open = market && marketIsOpen(market, matches.get(market.match_id), now);
  const signedOut = arena.mode === 'live' && !arena.authenticated;
  let preview;
  try { preview = tradePreview(quantity); } catch { preview = null; }
  return <form className="landing-trade-panel" onSubmit={event => {
    event.preventDefault();
    if (signedOut) { onAccount(); return; }
    if (preview && open && arena.accountLoaded) onTrade(market.id, side, preview.contracts);
  }}>
    <div className="trade-panel-heading"><span className="eyebrow">Contract calculator</span><span>Simulated coins</span></div>
    {market ? <><label className="field-label" htmlFor="landing-market">Prediction market</label><select id="landing-market" value={market.id} onChange={event => setMarketId(event.target.value)}>{markets.map(item => <option key={item.id} value={item.id}>{item.question}</option>)}</select></> : <p className="calculator-context">Explore the contract rules below. Sign in to select a published match.</p>}
    <fieldset><legend>Choose your outcome</legend><div className="outcome-toggle">{['YES', 'NO'].map(choice => <button type="button" key={choice} aria-pressed={side === choice} className={side === choice ? 'active' : ''} onClick={() => setSide(choice)}>{choice}</button>)}</div></fieldset>
    <label className="field-label" htmlFor="landing-contracts">Number of contracts</label><input id="landing-contracts" type="number" min="1" max="1000000000" step="1" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} required aria-describedby="landing-contract-note" aria-invalid={!preview} />
    <dl className="trade-summary"><div><dt>Price per contract</dt><dd>1 virtual coin</dd></div><div><dt>Total cost</dt><dd>{preview ? formatCoins(preview.cost) : '0'} coins</dd></div><div><dt>Return if correct</dt><dd>{preview ? formatCoins(preview.payout) : '0'} coins</dd></div><div><dt>Simulated profit if correct</dt><dd>+{preview ? formatCoins(preview.profit) : '0'} coins</dd></div></dl>
    <p id="landing-contract-note" className="form-note">{preview ? 'If incorrect, the stake is lost. A cancelled market returns it. A correct return includes your original stake. Virtual coins have no cash value.' : 'Enter a whole number of contracts from 1 to 1,000,000,000.'}</p>
    <button type="submit" className="button button-primary w-full" disabled={!preview || arena.busy || !signedOut && (!open || !arena.accountLoaded)}>{signedOut ? 'Sign in to place a prediction' : !market ? 'No published markets' : !open ? 'Market closed' : 'Review prediction'}</button>
    <p className="calculator-footnote">You will review and confirm before any virtual coins are spent.</p>
  </form>;
}

function LeaderboardPreview({ arena, onAccount, loading, loadingContent }) {
  if (loading) return loadingContent;
  if (arena.mode === 'live' && !arena.authenticated) return <div className="leaderboard-invitation"><span className="eyebrow">The account leaderboard</span><h3>Your place among the legends.</h3><p>Sign in to see the community's simulated scores and follow your own progress.</p><button className="button button-secondary" onClick={onAccount}>Sign in to view rankings</button></div>;
  const players = arena.mode === 'demo' ? [{ rank: 1, user_id: 'practice-user', display_name: 'You (practice)', total_coins: portfolioSummary(arena.data).total }] : arena.data.leaderboard.slice(0, 5);
  return <div className="landing-leaderboard"><div className="trade-panel-heading"><span className="eyebrow">{arena.mode === 'demo' ? 'Your practice ranking' : 'Current account rankings'}</span><span>Virtual coins</span></div>{players.length ? <div className="table-scroll" role="region" aria-label="Leaderboard preview" tabIndex="0"><table><thead><tr><th>Rank</th><th>Predictor</th><th className="numeric">Simulated score</th></tr></thead><tbody>{players.map(player => <tr key={player.user_id}><td><span className="rank-number">{player.rank}</span></td><td>{player.display_name}</td><td className="numeric">{formatCoins(player.total_coins)}</td></tr>)}</tbody></table></div> : <p className="inline-note">No account rankings have been published yet.</p>}<p className="inline-note">{arena.mode === 'demo' ? 'Only your own practice score is shown. No community ranks are invented.' : 'Scores combine wallet balances and stakes in unsettled markets.'}</p><a className="text-link" href="#leaderboard">View the leaderboard</a></div>;
}

export default function CinematicLanding({ arena, markets, matches, now, onAccount, onTrade, onOracle, loading, loadingContent, emptyContent }) {
  const featured = markets.find(market => marketIsOpen(market, matches.get(market.match_id), now)) || markets[0];
  const openMarkets = markets.filter(market => market.status === 'open');
  return <LazyMotion features={domAnimation} strict>
    <div className="cinematic-landing">
      <OdysseyChapter figure="odysseus" className="cinematic-hero" eager aria-labelledby="voyage-title">
        <div className="hero-copy">
          <span className="chapter-index">I / The departure</span>
          <span className="eyebrow">Prophecy of FaZe</span>
          <h1 id="voyage-title">Predict the Game.<br /><em>Become the Legend.</em></h1>
          <p>Every match is a new crossing. Make your call on FaZe with free virtual coins, follow your predictions, and chart your own journey to Ithaca.</p>
          <div className="hero-actions"><a className="button button-primary" href="#markets">Enter the Arena</a><a className="button button-secondary" href="#portfolio">View portfolio</a></div>
          <p className="hero-footnote">Inspired by Homer's Odyssey. 1,000 free starting coins. Simulated returns only.</p>
        </div>
        <div className="hero-product"><span className="product-caption">Your next port of call</span>{loading ? loadingContent : featured ? <MarketCard market={featured} match={matches.get(featured.match_id)} sample={arena.sample} featured now={now} onTrade={onTrade} onOracle={onOracle} /> : emptyContent}</div>
        <div className="voyage-marker"><span>A voyage in four chapters</span><span>Scroll to explore</span></div>
      </OdysseyChapter>
      <OdysseyChapter figure="athena" className="landing-markets" aria-labelledby="counsel-title">
        <span className="chapter-index">II / The counsel</span>
        <div className="chapter-heading"><div><span className="eyebrow">The prediction markets</span><h2 id="counsel-title">Wisdom before<br /><em>conviction.</em></h2></div><div><p>Read the question. Know the closing time. Choose YES or NO on the next FaZe match.</p><a className="text-link" href="#markets">Explore all markets</a></div></div>
        {loading ? loadingContent : openMarkets.length ? <div className="market-grid">{openMarkets.slice(0, 2).map(market => <MarketCard key={market.id} market={market} match={matches.get(market.match_id)} sample={arena.sample} now={now} onTrade={onTrade} onOracle={onOracle} />)}</div> : emptyContent}
        <p className="sample-warning">{arena.sample ? 'Practice fixtures use illustrative event names and schedules.' : 'Match records and prediction questions come from the project backend. Account access requires sign-in.'}</p>
      </OdysseyChapter>
      <OdysseyChapter figure="poseidon" className="landing-trading" waves aria-labelledby="crossing-title">
        <div className="crossing-copy"><span className="chapter-index">III / The crossing</span><span className="eyebrow">Make your call</span><h2 id="crossing-title">Navigate<br /><em>the unknown.</em></h2><p>One contract. One virtual coin. A correct prediction returns two coins, including your stake.</p><ol className="crossing-steps"><li><span>I</span><div><h3>Choose your crossing</h3><p>Select a match and read the prediction question.</p></div></li><li><span>II</span><div><h3>Make your call</h3><p>Choose YES or NO and preview your simulated return.</p></div></li><li><span>III</span><div><h3>Chart your progress</h3><p>Confirm your prediction, then follow the result in your portfolio.</p></div></li></ol><a className="text-link" href="#portfolio">Explore your portfolio</a></div>
        <TradeCalculator arena={arena} markets={markets} matches={matches} now={now} onTrade={onTrade} onAccount={onAccount} />
      </OdysseyChapter>
      <OdysseyChapter figure="ithaca" className="landing-destination" aria-labelledby="ithaca-title">
        <div className="destination-copy"><span className="chapter-index">IV / Ithaca</span><span className="eyebrow">The leaderboard</span><h2 id="ithaca-title">Every odyssey<br /><em>leaves a legacy.</em></h2><p>Follow your simulated performance from Wayfarer to Legend of Ithaca. Your next prediction writes the next chapter.</p><a className="button button-secondary" href="#leaderboard">Find your place</a></div>
        <LeaderboardPreview arena={arena} onAccount={onAccount} loading={loading} loadingContent={loadingContent} />
        <p className="destination-note">An unofficial HackUTA 2026 prototype. Free virtual coins only. No deposits, withdrawals, or cash-redeemable rewards.</p>
      </OdysseyChapter>
    </div>
  </LazyMotion>;
}
