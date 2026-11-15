import { formatTime, marketIsOpen } from '../domain.js';

export function TeamSeal({ name, large = false }) {
  const initials = name === 'FaZe Clan' ? 'F' : name === 'Team Vitality' ? 'V' : name === 'G2 Esports' ? 'G2' : (name?.trim()?.[0] || '?').toUpperCase();
  return <span aria-hidden="true" className={`team-seal ${name === 'FaZe Clan' ? 'faze-seal' : ''} ${large ? 'large' : ''}`}>{initials}</span>;
}

export default function MarketCard({ market, match, sample, onTrade, onOracle, featured = false, now = Date.now() }) {
  const open = marketIsOpen(market, match, now);
  const imported = !sample && match.external_reference?.startsWith('pandascore:match:');
  return <article className={`market-card ${featured ? 'featured-market' : ''}`}>
    <div className="market-meta"><span className="game-label">{match.game === 'CS2' ? 'Counter-Strike 2' : match.game}</span>{imported ? <span className="source-indicator" role="img" aria-label="Imported match from PandaScore" title="Imported match from PandaScore" /> : <span className="data-label">{sample ? 'Sample fixture' : 'Account market'}</span>}</div>
    <div className="market-event">{match.event_name}{match.format ? ` / ${match.format}` : ''}</div>
    <div className="matchup"><div><TeamSeal name="FaZe Clan" large /><strong>FaZe Clan</strong></div><span className="versus">VS</span><div><TeamSeal name={match.opponent} large /><strong>{match.opponent}</strong></div></div>
    <h3>{market.question}</h3>
    <div className="contract-options"><button className="contract-button yes-button" onClick={() => onTrade(market.id, 'YES')} disabled={!open}><span>Yes</span><strong>1 coin</strong></button><button className="contract-button no-button" onClick={() => onTrade(market.id, 'NO')} disabled={!open}><span>No</span><strong>1 coin</strong></button></div>
    <p className="contract-note">Correct call: 2 virtual coins per contract.</p>
    <div className="market-bottom"><span>{market.status === 'resolved' ? `Resolved: ${market.winning_side}` : market.status === 'cancelled' ? 'Cancelled: stakes refunded' : open ? `Starts ${formatTime(match.starts_at)}` : 'Closed. Awaiting result.'}</span><button className="text-link" onClick={() => onOracle(market.id)}>Match brief</button></div>
  </article>;
}
