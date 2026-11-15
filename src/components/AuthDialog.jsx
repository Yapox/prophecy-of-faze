import { useRef, useState } from 'react';
import { isConfigured, supabase } from '../api.js';
import Dialog from './Dialog.jsx';
import { authRedirect } from '../auth.js';

export default function AuthDialog({ onClose, onPractice, initialMode = 'login', onRecoveryComplete }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !isConfigured) return;
    if (mode === 'recovery' && (password.length < 8 || password !== confirmation)) {
      setMessage(password.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.');
      return;
    }
    submitting.current = true;
    setBusy(true); setMessage('');
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect('recovery') });
        if (error) throw new Error(error.code === 'over_email_send_rate_limit' ? 'Please wait before requesting another email.' : 'We could not send a reset email. Please try again.');
        setMessage('If an account uses this email, you will receive a password reset link. Check your inbox and spam folder.');
        return;
      }
      if (mode === 'recovery') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error(['session_not_found', 'session_expired', 'bad_jwt'].includes(error.code) ? 'This recovery link has expired. Request a new reset email.' : error.code === 'same_password' ? 'Choose a password different from your current password.' : 'Your password could not be updated. Try again or request a new reset link.');
        onRecoveryComplete?.();
        return;
      }
      const { data, error } = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirect() } });
      if (error) {
        const messages = { invalid_credentials: 'Check your email and password.', email_not_confirmed: 'Confirm your email before signing in.', weak_password: 'Choose a stronger password.', over_email_send_rate_limit: 'Please wait before requesting another email.' };
        throw new Error(messages[error.code] || 'We could not complete sign-in. Please try again.');
      }
      if (!data.session) setMessage('Check your email for confirmation, then sign in.');
      else onClose();
    } catch (error) { setMessage(error.message); }
    finally { setPassword(''); setConfirmation(''); setBusy(false); submitting.current = false; }
  }
  function switchMode(next) { setMode(next); setMessage(''); setPassword(''); setConfirmation(''); }
  if (mode === 'forgot' || mode === 'recovery') return <Dialog title={mode === 'forgot' ? 'Find your way back.' : 'Choose a new password.'} onClose={onClose} busy={busy}>
    <p className="muted">{mode === 'forgot' ? 'Request a secure email link to reset your account password.' : 'Use at least 8 characters. Your wallet and predictions stay with your account.'}</p>
    <form className="auth-recovery-form" onSubmit={submit}>
      {mode === 'forgot' ? <><label className="field-label" htmlFor="email">Account email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></> : <><label className="field-label" htmlFor="password">New password</label><input id="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /><label className="field-label" htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></>}
      {message && <p className="notice" role="status">{message}</p>}
      <button className="button button-primary w-full" disabled={busy}>{busy ? 'Please wait...' : mode === 'forgot' ? 'Send reset link' : 'Save new password'}</button>
    </form>
    <button className="text-link auth-switch" disabled={busy} onClick={() => switchMode(mode === 'forgot' ? 'login' : 'forgot')}>{mode === 'forgot' ? 'Back to sign in' : 'Request a new reset link'}</button>
  </Dialog>;
  return <Dialog title={mode === 'login' ? 'Welcome to the arena.' : 'Start your own odyssey.'} onClose={onClose} busy={busy}>
    {isConfigured ? <>
      <p className="muted">{mode === 'login' ? 'Your next call awaits.' : 'Start your odyssey with 1,000 free virtual coins.'}</p>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
        <label className="field-label" htmlFor="password">Password</label><input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : undefined} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
        <p className="form-note"><a href="#terms" onClick={onClose}>Draft terms</a> · <a href="#privacy" onClick={onClose}>Privacy notice</a></p>
        {message && <p className="notice" role="status">{message}</p>}
        <button className="button button-primary w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="text-link auth-switch" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>{mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button>
    </> : <><p className="muted">Account sign-in is unavailable. Try practice mode, saved on this device.</p><button className="button button-primary w-full" onClick={onPractice}>Continue in practice mode</button></>}
    {isConfigured && mode === 'login' && <button className="text-link auth-recovery-link" disabled={busy} onClick={() => switchMode('forgot')}>Forgot password?</button>}
  </Dialog>;
}
