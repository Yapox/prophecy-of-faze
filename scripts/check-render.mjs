import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
});
try {
  const { default: App } = await server.ssrLoadModule('/src/OdysseyApp.jsx');
  const { default: MarketCard } = await server.ssrLoadModule('/src/components/MarketCard.jsx');
  const { createPractice } = await server.ssrLoadModule('/src/domain.js');
  const sample = createPractice();
  const card = renderToString(createElement(MarketCard, { market: sample.markets[0], match: sample.matches[0], sample: true, onTrade() {}, onOracle() {} }));
  assert.match(card, /Will FaZe Clan beat NAVI/);
  assert.match(card, /Sample fixture/);
  assert.match(card, /1 coin/);
  const html = renderToString(createElement(App));
  assert.match(html, /Predict the Game\./);
  assert.match(html, /Become the Legend\./);
  assert.match(html, /Prophecy of FaZe/);
  assert.ok(html.length > 500, 'The app should render visible content.');
  console.log('PASS: the React app renders the hero and page content.');
} finally {
  await server.close();
}
