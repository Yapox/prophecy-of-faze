import { useState } from 'react';
import { formatCoins, formatTime, portfolioSummary } from '../domain.js';

export default function Portfolio({ arena, onTrade, onAuth }) {
  const [tab, setTab] = useState('open');
  const data = arena.data;
  const summary = portfolioSummary(data);
  const marketById = new Map(data.markets.map(market => [market.id, market]));
  const visible = data.positions.filter(position => tab === 'open' ? !marketById.has(position.market_id) || marketById.get(position.market_id).status === 'open' : marketById.get(position.market_id)?.status !== 'open');
  const openMarkets = data.markets.filter(market => market.status === 'open' && data.positions.some(position => position.market_id === market.id));
  if (arena.mode === 'live' && !arena.authenticated) return <div className="empty-state"><h3>Your odyssey starts here.</h3><p>Sign in to see your account wallet, positions, and simulated returns.</p><button className="button button-primary" onClick={onAuth}>Sign in</button></div>;
  if (!arena.accountLoaded) return null;
  return <>
    <div className="stats-grid">{[
      ['Available balance', formatCoins(summary.balance), 'Virtual coins ready to predict'],
      ['Committed to predictions', formatCoins(summary.committed), 'Stakes in unsettled markets'],
      ['Simulated profit / loss', `${summary.realized > 0 ? '+' : ''}${formatCoins(summary.realized)}`, 'Realized results only'],
      ['Possible return', formatCoins(summary.possiblePayout), 'If every open prediction wins'],
    ].map(([label, value, detail]) => <div className="stat" key={label}><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-detail">{detail}</span></div>)}</div>
    <div className="portfolio-tabs" role="group" aria-label="Portfolio view">{[['open', 'Open positions'], ['settled', 'Settled positions'], ['history', 'Transactions']].map(([value, label]) => <button key={value} aria-pressed={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}</div>
    {tab === 'history' ? <div className="table-scroll" role="region" aria-label="Transaction history" tabIndex="0"><table><thead><tr><th>Transaction</th><th>Time</th><th className="numeric">Coins</th><th className="numeric">Balance after</th></tr></thead><tbody>{data.history.map(item => <tr key={item.id}><td>{({ signup_bonus: arena.mode === 'demo' ? 'Practice starting coins' : 'Signup bonus', prediction_purchase: 'Prediction purchase', prediction_payout: 'Simulated payout', prediction_refund: 'Stake refund' })[item.kind] || item.kind}</td><td>{formatTime(item.created_at)}</td><td className={`numeric ${Number(item.amount) >= 0 ? 'positive' : 'negative'}`}>{Number(item.amount) > 0 ? '+' : ''}{formatCoins(item.amount)}</td><td className="numeric">{formatCoins(item.balance_after)}</td></tr>)}</tbody></table></div>
      : visible.length ? <div className="table-scroll" role="region" aria-label={`${tab} positions`} tabIndex="0"><table><thead><tr><th>Prediction</th><th>Outcome</th><th className="numeric">Contracts</th><th className="numeric">{tab === 'open' ? 'Possible return' : 'Simulated result'}</th></tr></thead><tbody>{visible.map(position => {
        const market = marketById.get(position.market_id);
        const profit = market?.status === 'cancelled' ? 0 : market?.winning_side === position.side ? Number(position.stake) : -Number(position.stake);
        return <tr key={position.id}><td>{market?.question || 'Prediction market'}<small>{market?.status === 'cancelled' ? 'Cancelled. Stake returned.' : market?.status === 'resolved' ? `${market.winning_side} won` : 'Awaiting match result'}</small></td><td><span className={`side-tag ${position.side === 'NO' ? 'no' : ''}`}>{position.side}</span></td><td className="numeric">{formatCoins(position.stake)}</td><td className={`numeric ${tab === 'settled' ? profit >= 0 ? 'positive' : 'negative' : ''}`}>{tab === 'open' ? formatCoins(Number(position.stake) * 2) : `${profit > 0 ? '+' : ''}${formatCoins(profit)}`} coins</td></tr>;
      })}</tbody></table></div> : <div className="empty-state"><h3>{tab === 'open' ? 'Your next call awaits.' : 'Results take time.'}</h3><p>{tab === 'open' ? 'Explore a match and choose an outcome to create your first simulated position.' : 'Settled predictions will appear here with their simulated profit or loss.'}</p><a className="button button-primary" href="#markets">Explore markets</a></div>}
    <p className="inline-note">Potential returns include your stake. Virtual coins have no cash value.</p>
    {arena.mode === 'demo' && <details className="practice-resolution"><summary>Practice tools: try a match result</summary><p>These controls resolve sample fixtures in this browser so you can test a win, loss, or refund. Account markets are resolved only by the trusted backend.</p>{openMarkets.length ? openMarkets.map(market => <div className="resolution-row" key={market.id}><strong>{market.question}</strong><div className="resolution-actions"><button className="button button-secondary button-small" onClick={() => arena.resolvePractice(market.id, 'YES')}>FaZe wins</button><button className="button button-secondary button-small" onClick={() => arena.resolvePractice(market.id, 'NO')}>FaZe loses</button><button className="button button-quiet button-small" onClick={() => arena.resolvePractice(market.id, null)}>Cancel match</button></div></div>) : <p>No open practice positions to resolve.</p>}<button className="text-link" onClick={() => { if (window.confirm('Reset this browser’s practice wallet and remove its sample predictions?')) arena.resetPractice(); }}>Reset practice wallet</button></details>}
  </>;
}
