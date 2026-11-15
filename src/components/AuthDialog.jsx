import { useState } from 'react';
import { isConfigured, supabase } from '../api.js';
import Dialog from './Dialog.jsx';

export default function AuthDialog({ onClose, onPractice }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (busy || !isConfigured) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (error) {
        const messages = { invalid_credentials: 'Check your email and password.', email_not_confirmed: 'Confirm your email before signing in.', weak_password: 'Choose a stronger password.', over_email_send_rate_limit: 'Please wait before requesting another email.' };
        throw new Error(messages[error.code] || 'We could not complete sign-in. Please try again.');
      }
      if (!data.session) setMessage('Check your email for confirmation, then sign in.');
      else onClose();
    } catch (error) { setMessage(error.message); }
    finally { setPassword(''); setBusy(false); }
  }
  return <Dialog title={mode === 'login' ? 'Welcome to the arena.' : 'Start your own odyssey.'} onClose={onClose} busy={busy}>
    {isConfigured ? <><p className="muted">{mode === 'login' ? 'Sign in to access your account wallet and predictions.' : 'New accounts receive 1,000 free virtual coins from the backend.'}</p><form onSubmit={submit}><label className="field-label" htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /><label className="field-label" htmlFor="password">Password</label><input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /><p className="form-note">Read the <a href="#terms" onClick={onClose}>draft terms</a> and <a href="#privacy" onClick={onClose}>privacy notice</a> before creating an account.</p>{message && <p className="notice" role="status">{message}</p>}<button className="button button-primary w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button></form><button className="text-link auth-switch" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>{mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button></>
      : <><p className="muted">Account sign-in becomes available when the project is connected to Supabase. You can use the complete practice experience now.</p><p className="notice">Practice predictions are saved in this browser. They are separate from Supabase accounts.</p><button className="button button-primary w-full" onClick={onPractice}>Continue in practice mode</button></>}
  </Dialog>;
}
