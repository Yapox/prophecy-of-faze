import { useEffect, useRef, useState } from 'react';
import { askOracle } from '../api.js';
import { formatTime } from '../domain.js';

export default function Oracle({ arena, selectedMarket, onSelect, onAuth }) {
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const market = arena.data.markets.find(item => item.id === selectedMarket) || arena.data.markets[0];
  const match = arena.data.matches.find(item => item.id === market?.match_id);
  useEffect(() => { generation.current++; setAnswer(null); setError(''); setBusy(false); return () => { generation.current++; }; }, [market?.id, arena.mode, arena.session?.user.id]);
  async function analyze() {
    if (!arena.authenticated) { onAuth(); return; }
    if (busy) return;
    const current = ++generation.current;
    setBusy(true); setError('');
    try {
      const response = await askOracle(market.id);
      if (current === generation.current) setAnswer(response);
    } catch (cause) { if (current === generation.current) setError(cause.message || 'The Oracle is unavailable. Try again later.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  if (!market || !match) return <div className="empty-state"><h3>No match to interpret yet.</h3><p>The Oracle uses the same match records as the markets dashboard. Check back when a match is posted.</p></div>;
  return <div className="oracle-layout"><aside className="oracle-context"><span className="eyebrow">The match record</span><label className="field-label" htmlFor="oracle-market">Choose a prediction</label><select id="oracle-market" value={market.id} onChange={event => onSelect(event.target.value)}>{arena.data.markets.map(item => <option key={item.id} value={item.id}>{item.question}</option>)}</select><h3>{market.question}</h3><dl className="facts"><div><dt>Game</dt><dd>{match.game}</dd></div><div><dt>Event</dt><dd>{match.event_name}</dd></div><div><dt>Starts</dt><dd>{formatTime(match.starts_at)}</dd></div><div><dt>Prediction closes</dt><dd>{formatTime(market.closes_at)}</dd></div><div><dt>Source</dt><dd>{arena.sample ? 'Seeded sample fixture. Not an actual schedule.' : 'Supabase match record'}</dd></div></dl></aside><section className="oracle-analysis"><span className="eyebrow">The Oracle</span><h2>Context before conviction.</h2><p>The Oracle explains the information available for a match. It cannot guarantee an outcome.</p><p>This prototype currently has event details and market rules. Player statistics, recent form, map records, and head-to-head results have not been supplied. There is no evidence here for a reliable win probability.</p><dl className="trade-summary"><div><dt>Cost of 100 contracts</dt><dd>100 virtual coins</dd></div><div><dt>Return if correct</dt><dd>200 virtual coins</dd></div><div><dt>Loss if incorrect</dt><dd>100 virtual coins</dd></div></dl>
    {arena.mode === 'demo' ? <p className="notice">This match brief is based on the sample record and contract rules. It is not AI-generated. Gemini analysis is available for signed-in account markets once the server is configured.</p> : <><button className="button button-primary" onClick={analyze} disabled={busy || !arena.authenticated}>{busy ? 'The Oracle is reading the record…' : 'Ask The Oracle'}</button>{!arena.authenticated && <button className="button button-quiet" onClick={onAuth}>Sign in for analysis</button>}</>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}{answer && <div className="ai-answer"><span className="eyebrow">Gemini analysis</span><p>{answer.text}</p><p className="source-note">Generated from the selected database match record. AI may make mistakes. No verified player performance statistics were provided.</p></div>}
  </section></div>;
}
