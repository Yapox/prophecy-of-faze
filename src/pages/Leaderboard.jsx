import { formatCoins, portfolioSummary, progression } from '../domain.js';

export default function Leaderboard({ arena, onAuth }) {
  if (arena.mode === 'live' && !arena.authenticated) return <div className="empty-state"><h3>Chart your course to Ithaca.</h3><p>Sign in to see the account leaderboard.</p><button className="button button-primary" onClick={onAuth}>Sign in</button></div>;
  if (!arena.accountLoaded) return null;
  const score = portfolioSummary(arena.data).total;
  const players = arena.mode === 'demo' ? [{ rank: 1, user_id: 'practice-user', display_name: 'You (practice)', total_coins: score }] : arena.data.leaderboard;
  const today = new Date().toDateString();
  const madePrediction = arena.data.positions.some(position => new Date(position.created_at).toDateString() === today);
  return <>
    <div className="progression-strip"><span className="rank-name">{progression(score)}</span><p>Your progression follows wallet coins plus unsettled stakes.<br />No cash rewards or redeemable prizes.</p></div>
    {arena.mode === 'demo' && <p className="inline-note">This is a personal practice ranking. No sample opponents or global ranks are invented.</p>}
    {players.length ? <div className="table-scroll" role="region" aria-label="Leaderboard" tabIndex="0"><table><thead><tr><th>Rank</th><th>Predictor</th><th>Progression</th><th className="numeric">Simulated score</th></tr></thead><tbody>{players.map(player => <tr key={player.user_id} className={player.user_id === arena.data.user.id ? 'current-user' : ''}><td><span className="rank-number">{player.rank}</span></td><td>{player.display_name}{player.user_id === arena.data.user.id && arena.mode !== 'demo' ? ' (you)' : ''}</td><td>{progression(Number(player.total_coins))}</td><td className="numeric">{formatCoins(player.total_coins)} coins</td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>The arena is waiting.</h3><p>There are no leaderboard entries yet.</p></div>}
    <div className="legend-path">{[['Wayfarer', 'Below 1,500'], ['Navigator', '1,500+'], ['Captain', '2,500+'], ['Legend of Ithaca', '5,000+']].map(([rank, amount]) => <span key={rank}><strong>{rank}</strong>{amount} virtual coins</span>)}</div>
    <div className="section-heading"><div><span className="eyebrow">A daily ritual</span><h2>Make today’s call.</h2></div></div><div className="challenge-line"><strong>Place one simulated prediction today.</strong><span>{madePrediction ? 'Completed today' : 'Ready when you are'}</span></div><p className="inline-note">This personal challenge tracks participation only. It does not award extra coins.</p>
  </>;
}
