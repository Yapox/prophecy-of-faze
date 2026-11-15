export function authRedirect(purpose) {
  const url = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
  if (purpose) url.searchParams.set('auth', purpose);
  return url.href;
}

export function recoveryRequested() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('auth') === 'recovery';
}

export function clearRecoveryLocation() {
  const url = new URL(window.location.href);
  url.searchParams.delete('auth');
  // Supabase consumes the token fragment. Never retain credentials in app routes.
  if (url.hash.includes('access_token=') || url.hash.includes('error=')) url.hash = '';
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
