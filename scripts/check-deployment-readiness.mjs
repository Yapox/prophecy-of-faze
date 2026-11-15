// Read-only PostgREST schema discovery. Never call a mutation to probe existence.
const origin = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (origin !== 'https://gkhzdoqpqjutuonysdpw.supabase.co' || !key?.startsWith('sb_secret_')) throw new Error('Expected deployment configuration is missing.');
try {
  const response = await fetch(`${origin}/rest/v1/`, {
    headers: { apikey: key, Accept: 'application/openapi+json' },
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('Schema discovery was unavailable');
  const schema = await response.json();
  if (!schema.paths?.['/rpc/settle_prediction_market'] || !schema.paths?.['/prediction_markets']) throw new Error('Expected service schema was not returned');
  const functions = Object.fromEntries(['sync_pandascore_match', 'settle_pandascore_prediction'].map(name => [name, Boolean(schema.paths[`/rpc/${name}`]?.post)]));
  const operationsLedger = Boolean(schema.paths['/prediction_operations']?.get);
  console.log(JSON.stringify({ check: 'automation-migration', timestamp: new Date().toISOString(), functions, operationsLedger, ready: Object.values(functions).every(Boolean) && operationsLedger, writes: 0 }));
} catch {
  console.error('Deployment readiness could not be established. No database writes or raw responses were logged.');
  process.exitCode = 1;
}
