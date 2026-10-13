/**
 * One-command MCP server for any Shopify store:
 *   SHOP_URL=https://yourstore.com npm start
 * Serves POST /mcp (Streamable HTTP, stateless, spec 2025-11-25) and GET /health on 127.0.0.1:8787.
 *
 * Env: SHOP_URL (required), SHOP_NAME, SHOP_CURRENCY (default USD), SHOP_REGION, PORT (8787),
 *      SHOP_SECRET (HMAC key for order confirmations; random per run if unset),
 *      DEMO_SHOPPER (local testing only: every request acts as this shopper, so the device closet and
 *      orders work. Leave it unset in production and take the shopper from a verified token instead).
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createShelfServer, FileStateStore, ShelfService, shopifyCatalog, type StoreConfig } from '../src/index.js';

const shopUrl = process.env.SHOP_URL;
if (!shopUrl) {
  console.error('Set SHOP_URL, for example: SHOP_URL=https://yourstore.com npm start');
  process.exit(1);
}
const origin = new URL(shopUrl).origin;
const host = new URL(origin).hostname.replace(/^www\./, '');
const store: StoreConfig = {
  id: host.split('.')[0].replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'store',
  name: process.env.SHOP_NAME ?? host,
  url: origin,
  currency: process.env.SHOP_CURRENCY ?? 'USD',
  region: process.env.SHOP_REGION,
  shipping: null,
};

const service = new ShelfService({
  catalog: shopifyCatalog(store, { cacheDir: './cache' }), // 1 s between pages, 6 h disk cache
  state: new FileStateStore('./data/state'),
  secret: process.env.SHOP_SECRET ?? randomBytes(32).toString('hex'),
});

const handler = createMcpHandler(
  () => createShelfServer({ service }, { userId: process.env.DEMO_SHOPPER }),
  { legacy: 'stateless' },
);
const mcp = toNodeHandler(handler);
const PORT = Number(process.env.PORT ?? 8787);

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, store: store.name, url: store.url, mcp: '/mcp' }));
    return;
  }
  if (path === '/mcp') return void mcp(req, res);
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`${store.name}: MCP server on http://127.0.0.1:${PORT}/mcp (catalog loads on the first tool call)`);
});
