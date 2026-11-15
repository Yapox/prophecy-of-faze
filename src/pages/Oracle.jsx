import { useEffect, useRef, useState } from 'react';
import { askOracle, oracleAvailable } from '../api.js';
import { formatTime } from '../domain.js';
import '../oracle.css';

const suggestions = ['Explain this matchup.', 'How do simulated payouts work?', 'What information is missing?'];

export default function Oracle({ arena, selectedMarket, onSelect, onAuth }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [stats, setStats] = useState(null);
  const generation = useRef(0);
  const inFlight = useRef(null);
  const input = useRef(null);
  const market = arena.data.markets.find(item => item.id === selectedMarket) || arena.data.markets[0];
  const match = arena.data.matches.find(item => item.id === market?.match_id);
  const busy = Boolean(pendingQuestion);

  useEffect(() => {
    generation.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setMessages([]); setDraft(''); setError(''); setPendingQuestion(''); setStats(null);
    return () => { generation.current++; inFlight.current?.abort(); inFlight.current = null; };
  }, [market?.id, arena.mode, arena.session?.user.id]);

  function newChat() {
    generation.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setMessages([]); setDraft(''); setError(''); setPendingQuestion(''); setStats(null);
    input.current?.focus();
  }

  async function send(question) {
    if (!arena.authenticated) { onAuth(); return; }
    if (!market || inFlight.current) return;
    const text = question.trim();
    if (!text || text.length > 1000) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const current = ++generation.current;
    setPendingQuestion(text); setDraft(''); setError('');
    try {
      const response = await askOracle(market.id, text, messages.slice(-6), { signal: controller.signal });
      if (current === generation.current) { setMessages(previous => [...previous, { role: 'user', text }, { role: 'model', text: response.text }]); setStats(response.stats || null); }
    } catch (cause) {
      if (current === generation.current) {
        setDraft(text);
        setError(cause.name === 'TimeoutError' ? 'The Oracle took too long to reply. Your question is ready to send again.' : cause.message || 'The Oracle is unavailable. Please try again.');
      }
    } finally {
      if (current === generation.current) {
        inFlight.current = null;
        setPendingQuestion('');
        input.current?.focus();
      }
    }
  }

  if (arena.mode === 'live' && !arena.authenticated) return <div className="empty-state"><h3>Speak with The Oracle.</h3><p>Sign in to ask about published FaZe matches and simulated predictions.</p><button className="button button-primary" onClick={onAuth}>Sign in to chat</button></div>;
  if (!market || !match) return <div className="empty-state"><h3>No match to interpret yet.</h3><p>The Oracle uses the same match records as the markets dashboard. Check back when a match is posted.</p></div>;

  return <div className="oracle-layout">
    <aside className="oracle-context">
      <span className="eyebrow">The match record</span>
      <label className="field-label" htmlFor="oracle-market">Choose a prediction</label>
      <select id="oracle-market" value={market.id} onChange={event => onSelect(event.target.value)}>{arena.data.markets.map(item => <option key={item.id} value={item.id}>{item.question}</option>)}</select>
      <h3>{market.question}</h3>
      <dl className="facts">
        <div><dt>Game</dt><dd>{match.game}</dd></div>
        <div><dt>Event</dt><dd>{match.event_name}</dd></div>
        <div><dt>Starts</dt><dd>{formatTime(match.starts_at)}</dd></div>
        <div><dt>Prediction closes</dt><dd>{formatTime(market.closes_at)}</dd></div>
        <div><dt>Source</dt><dd>{arena.sample ? 'Seeded sample fixture. Not an actual schedule.' : 'Supabase match record'}</dd></div>
      </dl>
      {stats && <section className="oracle-result-sample" aria-label="Provider result sample"><h3>Recent result sample</h3>{stats.available ? <><p className="source-note">PandaScore · fetched {formatTime(stats.checkedAt)} · {stats.scannedMatches} CS2 fixtures inspected. Up to five validated results per team.</p>{stats.teams.map(team => <div key={team.name}><strong>{team.name}</strong><p>{team.played ? `${team.wins} wins in ${team.played} sampled results` : 'No unambiguous results found in this sample.'}</p>{team.results.length > 0 && <ul>{team.results.map(result => <li key={result.providerMatchId}><span>{result.won ? 'Won' : 'Lost'} {result.scoreFor}:{result.scoreAgainst} vs {result.opponent}</span><time dateTime={result.endedAt}>{formatTime(result.endedAt)}</time></li>)}</ul>}</div>)}<p className="source-note">This bounded sample can omit matches. It is not a win probability. Player statistics are unavailable.</p></> : <p className="source-note">{stats.reason}</p>}</section>}
      <dl className="trade-summary">
        <div><dt>Cost of 100 contracts</dt><dd>100 virtual coins</dd></div>
        <div><dt>Return if correct</dt><dd>200 virtual coins</dd></div>
        <div><dt>Loss if incorrect</dt><dd>100 virtual coins</dd></div>
      </dl>
    </aside>
    <section className="oracle-analysis" aria-labelledby="oracle-chat-title">
      <div className="oracle-chat-heading"><div><span className="eyebrow">The Oracle / Gemini</span><h2 id="oracle-chat-title">Ask before you predict.</h2></div>{arena.mode === 'live' && <button className="text-link" onClick={newChat} disabled={!messages.length && !busy && !error}>New chat</button>}</div>
      <p>Ask about this match, follow up on an explanation, or learn how simulated contracts work. When configured, the server adds a sourced sample of recent CS2 results. Player statistics are not supplied.</p>
      {arena.mode === 'demo' ? <div className="notice"><p>This practice brief shows sample records and contract rules. It is not AI-generated. {oracleAvailable ? 'Sign in to chat with Gemini about account matches.' : 'The Oracle chat is not available on this deployment.'}</p><button className="button button-secondary button-small" onClick={onAuth}>Use account mode</button></div> : !oracleAvailable ? <div className="notice"><p>The Oracle chat is not available on this deployment. You can still explore matches and place simulated predictions.</p><a className="text-link" href="#markets">Explore markets</a></div> : <>
        <div className="oracle-conversation" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversation with The Oracle">
          {!messages.length && !busy && <div className="oracle-welcome"><span className="eyebrow">A question for your next crossing</span><p>Start with the match question or ask what a YES or NO contract means.</p></div>}
          {messages.map((message, index) => <article className={`oracle-message oracle-message-${message.role}`} key={index}><h3>{message.role === 'user' ? 'You' : 'The Oracle / Gemini'}</h3><p>{message.text}</p></article>)}
          {busy && <article className="oracle-message oracle-message-user"><h3>You</h3><p>{pendingQuestion}</p></article>}
        </div>
        <div className="oracle-chat-status" role="status">{busy ? 'The Oracle is replying...' : ''}</div>
        {!messages.length && <div className="oracle-suggestions" role="group" aria-label="Suggested questions">{suggestions.map(question => <button type="button" className="button button-secondary button-small" key={question} disabled={busy} onClick={() => send(question)}>{question}</button>)}</div>}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <form className="oracle-composer" onSubmit={event => { event.preventDefault(); send(draft); }}>
          <label className="field-label" htmlFor="oracle-question">Your question</label>
          <textarea ref={input} id="oracle-question" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }} maxLength={1000} rows={3} readOnly={busy} required aria-describedby="oracle-input-note" placeholder="What does choosing YES mean for this match?" />
          <div className="oracle-composer-actions"><span id="oracle-input-note">{draft.length}/1,000 characters. Ctrl or Command + Enter to send.</span><button className="button button-primary" type="submit" disabled={busy || !draft.trim()}>{busy ? 'Waiting for reply...' : 'Send question'}</button></div>
        </form>
        <p className="source-note">Replies use the selected backend match record and simulated contract rules. AI can make mistakes. Your question and recent chat messages are sent to Google Gemini. Avoid personal information. This chat stays in page memory and clears when you change matches or leave this page.</p>
      </>}
    </section>
  </div>;
}
