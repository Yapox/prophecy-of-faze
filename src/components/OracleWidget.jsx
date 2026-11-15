import { useEffect, useRef, useState } from 'react';
import Oracle from '../pages/Oracle.jsx';
import { oracleAvailable } from '../api.js';
import '../oracle-widget.css';

function Flame() {
  return <svg className="oracle-flame" viewBox="0 0 36 44" width="30" height="36" aria-hidden="true" focusable="false"><path className="oracle-flame-outer" d="M19 1c3 10-7 13-4 20 3-2 5-6 6-10 6 5 13 13 13 20 0 7-6 12-16 12C8 43 2 37 2 30c0-7 4-13 9-18-1 7 0 10 2 11C10 14 19 9 19 1Z" fill="#ffb24f" /><path className="oracle-flame-inner" d="M20 23c0 6-6 7-6 11 0 2 2 5 5 5 5 0 8-3 8-7 0-4-4-7-7-9Z" fill="#fff1d2" /></svg>;
}

export default function OracleWidget({ arena, onAuth, obscured = false }) {
  const [open, setOpen] = useState(false);
  const [market, setMarket] = useState('');
  const launcher = useRef(null);
  const panel = useRef(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (obscured) return;
    if (open) panel.current?.querySelector('textarea, .oracle-widget-close')?.focus({ preventScroll: true });
    else if (wasOpen.current) launcher.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open, obscured, arena.authenticated]);

  useEffect(() => {
    if (!open || obscured) return;
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, obscured]);

  return <div className="oracle-widget" hidden={obscured}>
    <section ref={panel} id="oracle-home-chat" className={`oracle-widget-panel${oracleAvailable && arena.mode === 'live' && arena.authenticated ? ' has-conversation' : ''}`} role="dialog" aria-labelledby="oracle-home-title" hidden={!open}>
      <div className="oracle-widget-header"><span className="oracle-widget-seal"><Flame /></span><div><h2 id="oracle-home-title">The Oracle</h2><p>Gemini · App &amp; trading help</p></div><button type="button" className="oracle-widget-close" aria-label="Close Oracle chat" onClick={() => setOpen(false)}><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></div>
      <div className="oracle-widget-body"><Oracle arena={arena} selectedMarket={market} onSelect={setMarket} onAuth={onAuth} compact active={open && !obscured} /></div>
    </section>
    <button ref={launcher} type="button" className="oracle-widget-launcher" aria-label={open ? 'Minimize Oracle chat' : 'Open Oracle chat'} aria-expanded={open} aria-controls="oracle-home-chat" onClick={() => setOpen(previous => !previous)}>
      <span className="oracle-widget-fire"><Flame /></span><span className="oracle-widget-label">{open ? 'Close chat' : 'Ask The Oracle'}<small>App &amp; trading help</small></span>
    </button>
  </div>;
}
