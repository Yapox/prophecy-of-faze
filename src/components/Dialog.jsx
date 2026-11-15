import { useEffect, useRef } from 'react';

export default function Dialog({ title, onClose, busy = false, children, wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement;
    if (!element.open) element.showModal();
    return () => { element.close(); previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-labelledby="dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy) closeRef.current(); }}>
    <div className="dialog-top"><span className="eyebrow">Prophecy of FaZe</span><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}>×</button></div>
    <h2 id="dialog-title">{title}</h2>{children}
  </dialog>;
}
