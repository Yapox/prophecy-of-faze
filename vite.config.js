import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createOracleHandler, MAX_ORACLE_BODY_BYTES } from './api/oracle.js';

export default defineConfig(({ mode }) => {
  const handler = createOracleHandler({ env: { ...loadEnv(mode, process.cwd(), ''), ...process.env } });
  return {
    plugins: [react(), tailwindcss(), {
      name: 'oracle-local-api',
      configureServer(server) {
        server.middlewares.use('/api/oracle', async (req, res) => {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += Buffer.byteLength(chunk);
            if (bytes > MAX_ORACLE_BODY_BYTES) {
              res.statusCode = 413;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.end(JSON.stringify({ error: 'This conversation is too large. Start a new chat.' }));
              return;
            }
            chunks.push(chunk);
          }
          req.body = Buffer.concat(chunks).toString('utf8') || '{}';
          await handler(req, res);
        });
      },
    }],
  };
});
