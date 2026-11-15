import { formatCoins, portfolioSummary, progression } from '../domain.js';
import Activity from '../components/Activity.jsx';

export default function Leaderboard({ arena, onAuth, now = Date.now() }) {
  if (arena.mode === 'live' && !arena.authenticated) return <div className="empty-state"><h3>Chart your course to Ithaca.</h3><p>Sign in to see the account leaderboard.</p><button className="button button-primary" onClick={onAuth}>Sign in</button></div>;
  if (!arena.accountLoaded) return null;
  const score = portfolioSummary(arena.data).total;
  const players = arena.mode === 'demo' ? [{ rank: 1, user_id: 'practice-user', display_name: 'You (practice)', total_coins: score }] : arena.data.leaderboard;
  return <>
    <div className="progression-strip"><span className="rank-name">{progression(score)}</span><p>Score = wallet + open stakes.</p></div>
    {arena.mode === 'demo' && <p className="inline-note">Your practice score. Sign in for community rankings.</p>}
    {players.length ? <div className="table-scroll" role="region" aria-label="Leaderboard" tabIndex="0"><table><thead><tr><th>Rank</th><th>Predictor</th><th>Progression</th><th className="numeric">Simulated score</th></tr></thead><tbody>{players.map(player => <tr key={player.user_id} className={player.user_id === arena.data.user.id ? 'current-user' : ''}><td><span className="rank-number">{player.rank}</span></td><td>{player.display_name}{player.user_id === arena.data.user.id && arena.mode !== 'demo' ? ' (you)' : ''}</td><td>{progression(Number(player.total_coins))}</td><td className="numeric">{formatCoins(player.total_coins)} coins</td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>The arena is waiting.</h3><p>There are no leaderboard entries yet.</p></div>}
    <div className="legend-path">{[['Wayfarer', 'Below 1,500'], ['Navigator', '1,500+'], ['Captain', '2,500+'], ['Legend of Ithaca', '5,000+']].map(([rank, amount]) => <span key={rank}><strong>{rank}</strong>{amount} virtual coins</span>)}</div>
    <Activity data={arena.data} now={now} />
  </>;
}
