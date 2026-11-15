import { createClient } from '@supabase/supabase-js';
import { createOracleFetchHandler } from '../supabase/functions/_shared/oracle.js';

export { MAX_ORACLE_BODY_BYTES } from '../supabase/functions/_shared/oracle.js';

// Local Vite and optional Node hosting use the same handler as Supabase Edge.
export function createOracleHandler(options = {}) {
  const handler = createOracleFetchHandler({ env: process.env, database: createClient, ...options });
  return async (req, res) => {
    const method = req.method || 'GET';
    const request = new Request('http://localhost/api/oracle', {
      method,
      headers: req.headers,
      ...(!['GET', 'HEAD'].includes(method) ? { body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}) } : {}),
    });
    const response = await handler(request);
    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name.replace(/(^|-)[a-z]/g, part => part.toUpperCase()), value);
    res.end(await response.text() || undefined);
  };
}

export default createOracleHandler();
