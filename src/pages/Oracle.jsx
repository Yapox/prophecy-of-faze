import { useEffect, useRef, useState } from 'react';
import { askOracle, oracleAvailable } from '../api.js';
import { formatTime } from '../domain.js';
import '../oracle.css';

const suggestions = ['Explain this matchup.', 'How do simulated payouts work?', 'What information is missing?'];
const appSuggestions = ['How do predictions work?', 'Where is my portfolio?', 'How do I get coins?'];

export default function Oracle({ arena, selectedMarket, onSelect, onAuth, compact = false, active = true }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [stats, setStats] = useState(null);
  const generation = useRef(0);
  const inFlight = useRef(null);
  const input = useRef(null);
  const log = useRef(null);
  const market = arena.data.markets.find(item => item.id === selectedMarket) || (compact ? null : arena.data.markets[0]);
  const match = arena.data.matches.find(item => item.id === market?.match_id);
  const busy = Boolean(pendingQuestion);
  const questionId = compact ? 'oracle-widget-question' : 'oracle-question';
  const noteId = compact ? 'oracle-widget-input-note' : 'oracle-input-note';

  useEffect(() => {
    generation.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setMessages([]); setDraft(''); setError(''); setPendingQuestion(''); setStats(null);
    return () => { generation.current++; inFlight.current?.abort(); inFlight.current = null; };
  }, [market?.id, arena.mode, arena.session?.user.id]);

  useEffect(() => {
    if (active || !compact) return;
    generation.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setDraft(previous => previous || pendingQuestion);
    setPendingQuestion('');
  }, [active, compact]);

  useEffect(() => {
    if (active && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, pendingQuestion, active]);

  function newChat() {
    generation.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setMessages([]); setDraft(''); setError(''); setPendingQuestion(''); setStats(null);
    input.current?.focus();
  }

  async function send(question) {
    if (!arena.authenticated) { onAuth(); return; }
    if ((!compact && !market) || inFlight.current) return;
    const text = question.trim();
    if (!text || text.length > 1000) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const current = ++generation.current;
    setPendingQuestion(text); setDraft(''); setError('');
    try {
      const response = await askOracle(market?.id || null, text, messages.slice(-6), { signal: controller.signal });
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

  if (compact && !oracleAvailable) return <div className="oracle-widget-empty"><h3>Your next call starts here.</h3><p>Live chat is being connected. Explore the arena while The Oracle gets ready.</p><a className="button button-secondary" href="#markets">Explore markets</a><a className="text-link" href="#portfolio">View portfolio</a></div>;
  if (compact && (arena.mode !== 'live' || !arena.authenticated)) return <div className="oracle-widget-empty"><h3>The arena, explained.</h3><p>Questions about YES or NO, virtual coins, or your portfolio? Sign in and ask The Oracle.</p><div className="oracle-widget-topics"><span>Predictions</span><span>Coins</span><span>App help</span></div><button className="button oracle-fire-action" onClick={onAuth}>{arena.mode === 'demo' ? 'Use account mode to chat' : 'Sign in to chat'}</button><p className="oracle-widget-disclaimer">Simulated coins only. No cash value.</p></div>;
  if (arena.mode === 'live' && !arena.authenticated) return <div className="empty-state"><h3>Speak with The Oracle.</h3><p>Sign in to ask about published FaZe matches and simulated predictions.</p><button className="button button-primary" onClick={onAuth}>Sign in to chat</button></div>;
  if (!compact && (!market || !match)) return <div className="empty-state"><h3>No match to interpret yet.</h3><p>Check back when the next match is posted.</p></div>;

  return <div className={compact ? 'oracle-compact' : 'oracle-layout'}>
    {compact ? <div className="oracle-widget-context"><label htmlFor="oracle-widget-market">Ask about</label><select id="oracle-widget-market" value={market?.id || ''} onChange={event => onSelect(event.target.value)}><option value="">App &amp; trading help</option>{arena.data.markets.map(item => <option key={item.id} value={item.id}>{item.question}</option>)}</select></div> : <aside className="oracle-context">
      <span className="eyebrow">Your matchup</span>
      <label className="field-label" htmlFor="oracle-market">Choose a prediction</label>
      <select id="oracle-market" value={market.id} onChange={event => onSelect(event.target.value)}>{arena.data.markets.map(item => <option key={item.id} value={item.id}>{item.question}</option>)}</select>
      <h3>{market.question}</h3>
      <dl className="facts">
        <div><dt>Game</dt><dd>{match.game}</dd></div>
        <div><dt>Event</dt><dd>{match.event_name}</dd></div>
        <div><dt>Starts</dt><dd>{formatTime(match.starts_at)}</dd></div>
        <div><dt>Prediction closes</dt><dd>{formatTime(market.closes_at)}</dd></div>
        <div><dt>Source</dt><dd>{arena.sample ? 'Sample fixture' : 'Published match'}</dd></div>
      </dl>
      {stats && <section className="oracle-result-sample" aria-label="Provider result sample"><h3>Recent result sample</h3>{stats.available ? <><p className="source-note">PandaScore · fetched {formatTime(stats.checkedAt)} · {stats.scannedMatches} CS2 fixtures inspected. Up to five validated results per team.</p>{stats.teams.map(team => <div key={team.name}><strong>{team.name}</strong><p>{team.played ? `${team.wins} wins in ${team.played} sampled results` : 'No unambiguous results found in this sample.'}</p>{team.results.length > 0 && <ul>{team.results.map(result => <li key={result.providerMatchId}><span>{result.won ? 'Won' : 'Lost'} {result.scoreFor}:{result.scoreAgainst} vs {result.opponent}</span><time dateTime={result.endedAt}>{formatTime(result.endedAt)}</time></li>)}</ul>}</div>)}<p className="source-note">This bounded sample can omit matches. It is not a win probability. Player statistics are unavailable.</p></> : <p className="source-note">{stats.reason}</p>}</section>}
    </aside>}
    <section className="oracle-analysis" aria-labelledby={compact ? undefined : 'oracle-chat-title'} aria-label={compact ? 'Chat with The Oracle' : undefined}>
      <div className="oracle-chat-heading">{!compact && <div><span className="eyebrow">The Oracle / Gemini</span><h2 id="oracle-chat-title">Ask before you predict.</h2></div>}{arena.mode === 'live' && (!compact || messages.length > 0 || busy || error) && <button className="text-link" onClick={newChat} disabled={!messages.length && !busy && !error}>New chat</button>}</div>
      {!compact && <p>Explore the matchup. Understand your next call.</p>}
      {arena.mode === 'demo' ? <div className="notice"><p>This practice brief shows sample records and contract rules. It is not AI-generated. {oracleAvailable ? 'Sign in to chat with Gemini about account matches.' : 'The Oracle chat is not available on this deployment.'}</p><button className="button button-secondary button-small" onClick={onAuth}>Use account mode</button></div> : !oracleAvailable ? <div className="notice"><p>The Oracle chat is not available on this deployment. You can still explore matches and place simulated predictions.</p><a className="text-link" href="#markets">Explore markets</a></div> : <>
        <div className="oracle-conversation" ref={log} role="log" tabIndex="0" aria-live="polite" aria-relevant="additions text" aria-label="Conversation with The Oracle">
          {!messages.length && !busy && <div className="oracle-welcome">{compact ? <><h3>The arena, explained.</h3><p>Ask about predictions, virtual coins, or finding your way around.</p></> : <><span className="eyebrow">A question for your next crossing</span><p>Start with the match question or ask what a YES or NO contract means.</p></>}</div>}
          {messages.map((message, index) => <article className={`oracle-message oracle-message-${message.role}`} key={index}><h3>{message.role === 'user' ? 'You' : 'The Oracle / Gemini'}</h3><p>{message.text}</p></article>)}
          {busy && <article className="oracle-message oracle-message-user"><h3>You</h3><p>{pendingQuestion}</p></article>}
        </div>
        <div className="oracle-chat-status" role="status">{busy ? 'The Oracle is replying...' : ''}</div>
        {!messages.length && <div className="oracle-suggestions" role="group" aria-label="Suggested questions">{(compact && !market ? appSuggestions : suggestions).map(question => <button type="button" className="button button-secondary button-small" key={question} disabled={busy} onClick={() => send(question)}>{question}</button>)}</div>}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <form className="oracle-composer" onSubmit={event => { event.preventDefault(); send(draft); }}>
          <label className="field-label" htmlFor={questionId}>Your question</label>
          <textarea ref={input} id={questionId} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }} maxLength={1000} rows={compact ? 2 : 3} readOnly={busy} required aria-describedby={noteId} placeholder={compact ? 'Ask about the arena...' : 'What does choosing YES mean for this match?'} />
          <div className="oracle-composer-actions"><span id={noteId}>{draft.length}/1,000{!compact && ' characters. Ctrl or Command + Enter to send.'}</span><button className={`button ${compact ? 'oracle-fire-action' : 'button-primary'}`} type="submit" disabled={busy || !draft.trim()}>{busy ? compact ? 'Replying...' : 'Waiting for reply...' : compact ? 'Send' : 'Send question'}</button></div>
        </form>
        <p className="source-note">{compact ? 'Gemini can make mistakes. Keep personal details out of chat.' : 'AI can make mistakes. Messages are sent to Google Gemini; avoid personal details. Chat clears when you leave or change matches.'}</p>
      </>}
    </section>
  </div>;
}
