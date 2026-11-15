import { createClient } from '@supabase/supabase-js';
import { createOracleFetchHandler } from '../_shared/oracle.js';

// Supabase injects public keys. Never use a service-role key for user queries.
let publicKeys: Record<string, string> = {};
try { publicKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}'); }
catch { /* Legacy projects also expose SUPABASE_ANON_KEY. */ }

const handler = createOracleFetchHandler({
  database: createClient,
  env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_PUBLISHABLE_KEY: publicKeys.default || Deno.env.get('SUPABASE_ANON_KEY'),
    GEMINI_API_KEY: Deno.env.get('GEMINI_API_KEY'),
    GEMINI_MODEL: Deno.env.get('GEMINI_MODEL'),
    ORACLE_ALLOWED_ORIGINS: Deno.env.get('ORACLE_ALLOWED_ORIGINS') || 'https://yapox.github.io',
    ORACLE_DURABLE_RATE_LIMIT: Deno.env.get('ORACLE_DURABLE_RATE_LIMIT'),
    PANDASCORE_API_TOKEN: Deno.env.get('PANDASCORE_API_TOKEN'),
  },
});

Deno.serve(handler);
