import { useRef, useState } from 'react';
import { formatCoins, marketIsOpen, tradePreview } from '../domain.js';
import Dialog from './Dialog.jsx';

export default function TradeDialog({ market, match, initialSide, initialQuantity = 100, arena, onClose, onPortfolio, now }) {
  const [side, setSide] = useState(arena.pending?.args.p_side || initialSide || 'YES');
  const [quantity, setQuantity] = useState(String(arena.pending?.args.p_stake || initialQuantity));
  const [confirmed, setConfirmed] = useState(false);
  const [validation, setValidation] = useState('');
  const submitting = useRef(false);
  let preview;
  try { preview = tradePreview(quantity); } catch { preview = null; }
  const pending = arena.pending;
  const locked = arena.busy || Boolean(pending);
  const open = marketIsOpen(market, match, now);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    setValidation('');
    if (!pending && (!preview || preview.cost > arena.data.wallet.balance)) {
      setValidation(preview ? 'You do not have enough virtual coins.' : 'Enter a positive whole number of contracts.');
      return;
    }
    submitting.current = true;
    try {
      const result = await arena.purchase(market.id, side, preview?.contracts, pending);
      if (result) setConfirmed(true);
      else submitting.current = false;
    } catch {
      submitting.current = false;
      setValidation('The purchase could not be confirmed. Review any pending request before trying again.');
    }
  }
  return <Dialog title={confirmed ? 'Your prediction is placed.' : 'Make your prediction'} onClose={onClose} busy={arena.busy}>
    {confirmed ? <div className="trade-success"><span className="success-seal" aria-hidden="true">P</span><p>Follow the result in your portfolio.</p><button className="button button-primary w-full" onClick={onPortfolio}>View portfolio</button><button className="button button-quiet w-full" onClick={onClose}>Keep exploring</button></div> : <>
      <div className="trade-context"><span className="game-label">{match.game} / {arena.mode === 'demo' ? 'Sample fixture' : 'Account market'}</span><h3>{market.question}</h3></div>
      <form onSubmit={submit}>
        <fieldset disabled={locked}><legend>Choose your outcome</legend><div className="outcome-toggle">{['YES', 'NO'].map(choice => <button key={choice} type="button" aria-pressed={side === choice} className={side === choice ? 'active' : ''} onClick={() => setSide(choice)}>{choice === 'YES' ? 'Yes, FaZe wins' : 'No, FaZe loses'}</button>)}</div>
        <label className="field-label" htmlFor="contract-count">Number of contracts</label><input id="contract-count" type="number" min="1" max="1000000000" step="1" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} required />
        <div className="quantity-presets">{[25, 100, 250].map(amount => <button type="button" key={amount} onClick={() => setQuantity(String(amount))}>{amount}</button>)}</div></fieldset>
        <dl className="trade-summary"><div><dt>Price per contract</dt><dd>1 virtual coin</dd></div><div><dt>Total cost</dt><dd>{preview ? formatCoins(preview.cost) : '0'} coins</dd></div><div><dt>Return if correct</dt><dd>{preview ? formatCoins(preview.payout) : '0'} coins</dd></div><div><dt>Simulated profit if correct</dt><dd>+{preview ? formatCoins(preview.profit) : '0'} coins</dd></div></dl>
        <p className="form-note">If incorrect, the stake is lost. A cancelled market returns the stake. No cash value.</p>
        <div aria-live="polite">{(validation || arena.tradeMessage) && <p className="notice">{validation || arena.tradeMessage}</p>}</div>
        {pending && <p className="notice">A purchase is awaiting confirmation. Retry its original outcome and amount using the same request.</p>}
        <button className="button button-primary w-full" disabled={arena.busy || (!pending && (!open || !preview || preview.cost > arena.data.wallet.balance))}>{arena.busy ? 'Confirming prediction…' : pending ? 'Retry original purchase' : !open ? 'Market closed' : 'Confirm simulated trade'}</button>
        <p className="balance-note">Available balance: {formatCoins(arena.data.wallet.balance)} virtual coins</p>
      </form>
    </>}
  </Dialog>;
}
