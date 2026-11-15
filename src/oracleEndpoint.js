export function oracleEndpoint(config) {
  const value = config.VITE_ORACLE_URL?.trim();
  if (!value) return config.VITE_STATIC_HOSTING === 'true' ? null : '/api/oracle';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}
