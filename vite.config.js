import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createOracleHandler } from './api/oracle.js';

export default defineConfig(({ mode }) => {
  const handler = createOracleHandler({ env: { ...loadEnv(mode, process.cwd(), ''), ...process.env } });
  return {
    plugins: [react(), tailwindcss(), {
      name: 'oracle-local-api',
      configureServer(server) {
        server.middlewares.use('/api/oracle', async (req, res) => {
          let body = '';
          for await (const chunk of req) {
            body += chunk.toString();
            if (Buffer.byteLength(body) > 8192) { res.statusCode = 413; res.end('Request too large'); return; }
          }
          req.body = body || '{}';
          await handler(req, res);
        });
      },
    }],
  };
});
