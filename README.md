# Shelf to Alexa

Turn any Shopify catalog into an MCP server for Alexa+: search, compare, honest compatibility with quotes,
a device closet that follows the shopper, and orders in two confirmed steps.

It reads the store's public `/products.json` and serves 9 MCP tools over Streamable HTTP (spec 2025-11-25).
Every price, stock flag and compatibility claim comes from the store's own data. There is no LLM inside: the host
model (Alexa+, Claude, anything that speaks MCP) decides which tool to call, and this library answers only with
what the store says.

- **Reference app:** [Shop Counter](https://github.com/DmitriyTopka/shop-counter), an Alexa+ add-on built on this
  library, with MCP App screens for Echo Show, account linking over OAuth and a deploy to AWS Lambda.
- **Live demo (nothing to install):** https://x2uph6avweit5yuv5crwm474240pwtzb.lambda-url.us-east-1.on.aws/sim/
  is an Echo Show simulator talking to two real stores (Satechi and Roborock) through this library.

## Start in 10 minutes

Node.js 22 or newer.

```bash
git clone https://github.com/DmitriyTopka/shelf-to-alexa.git
cd shelf-to-alexa
npm ci
SHOP_URL=https://yourstore.com SHOP_REGION=US DEMO_SHOPPER=me npm start
```

That serves `http://127.0.0.1:8787/mcp` for that store (`examples/serve.ts`, under 60 lines). The catalog is fetched on
the first tool call, one page a second, and cached on disk for 6 hours. Check the store's terms before you read its
feed.

Why the two extra variables:

- `SHOP_REGION=US` picks the US plug or region variant. Without it you get the first variant in stock, which can be
  a foreign plug. On satechi.net, for example, the 100W wall charger comes back as the `AU` version because the US
  one is sold out.
- `DEMO_SHOPPER=me` makes every request act as one local shopper. Without it search and compare still work, but the
  device closet and orders answer "only when you're signed in". Use it for local testing only.

`curl http://127.0.0.1:8787/health` tells you the server is up and which store it reads. To stop the server, press
Ctrl+C in that terminal (or `kill` its PID if you started it in the background).

Try it with curl:

```bash
H=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-11-25')
curl -s -X POST http://127.0.0.1:8787/mcp "${H[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_products","arguments":{"need":"charger for my iPhone 15"}}}'
```

Answers come back as one Server-Sent Event (`event: message` / `data: {...}`): that is how the SDK replies to
2025-11-25 clients. Or point any MCP client (MCP Inspector, Claude Desktop through a bridge, your own host) at the URL.

Options, all environment variables: `SHOP_NAME`, `SHOP_CURRENCY` (default `USD`), `SHOP_REGION` (preferred plug or
region variant, e.g. `US`), `PORT`, `SHOP_SECRET` (HMAC key for order confirmations), and `DEMO_SHOPPER=me` for local
testing only, so the closet and orders have a shopper to belong to.

## The tools

| Tool | What the shopper gets |
|---|---|
| `find_products` | Up to 3 picks for a need ("charger for my iPhone 15 and MacBook Air", a budget), each with reasons |
| `compare_products` | A side-by-side table and a one-line verdict with the trade-off |
| `check_compatibility` | One of four honest statuses, with the store's own words as the quote (below) |
| `remember_my_devices` / `my_devices` | A device closet that survives across sessions, with at most one accessory the store itself lists for it |
| `prepare_order` / `place_order` | A priced preview with an HMAC confirmation token (10 minutes), then a simulated order; replays never double-order |
| `order_status` | "Where is my order", in any later session |
| `talk_to_staff` | A ticket for a human, with a pluggable notifier |

Each tool returns one or two sentences written to be spoken (`content[0].text`, cut to two sentences in code) plus
`structuredContent` for a screen. Eight tools point at an MCP App view (`ui://shop-counter/view.html` by default). The
library ships a minimal fallback view; pass your own HTML with the `view` option (Shop Counter's Echo Show view is
one example).

## Honest compatibility

`check_compatibility` never guesses. It returns:

| Status | When | Spoken like |
|---|---|---|
| `confirmed` | The store names this exact model, in a tag or in a "compatible with / designed for" phrase. The quote is shown. | "Yes, the store lists the iPhone 15 for the OntheGo 67W Slim Wall Charger." |
| `family_only` | The store names only the series or family ("iPhone 17" for an iPhone 17 Pro). Not proof of fit. | "The store lists iPhone 17, not your iPhone 17 Pro specifically." |
| `not_listed` | The store is silent about this device. | "I can't confirm that: the store doesn't list the Pixel 9 for the ...", then a product the store does list for it, when there is one |
| `incompatible` | The store says "not compatible with X", or a hard connector rule rules it out. The quote is shown. | `No, that won't work with your Saros 10R: the store says "Not compatible with Saros 10R".` |

Rules behind it:

- Devices come from a dictionary (Apple, Samsung, Google, Microsoft). A bare "iPhone" never confirms a specific
  model. Devices outside the dictionary (robot vacuums, for example) are matched by model name with model
  boundaries, so "for Qrevo Curv" does not confirm a plain Qrevo, and "Qrevo only" does not deny it.
- "My phone" with two phones in the closet returns `device_ambiguous` with the options, so the host asks which one.
- Descriptions count as a listing only inside phrases like "designed for" or "compatible with". "Pairs naturally
  with MacBook Pro" is marketing, not a promise.
- Tags feed compatibility only. Stores use tags as merchandising labels ("magsafe charger" on a plain cable).
- Wattage is read from the title or from explicit phrases. Shopify HTML sometimes splits digits across tags
  (`1<span>5</span> W`); that is never read as 5 W or 15 W.
- Warranty plans and trade-ins are classified before ranking, so they never show up as the cheapest robot.

## Use it as a library

The package is not on npm. Install it straight from GitHub:

```bash
npm install github:DmitriyTopka/shelf-to-alexa
```

npm clones the repo and builds `dist/` on install (the `prepare` script), so the first install takes a few extra
seconds. Pin a commit with `github:DmitriyTopka/shelf-to-alexa#<commit>` if you want the same code every time.

```ts
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createShelfServer, FileStateStore, ShelfService, shopifyCatalog } from 'shelf-to-alexa';

const store = { id: 'mystore', name: 'My Store', url: 'https://mystore.com', currency: 'USD', region: 'US', shipping: null };
const service = new ShelfService({
  catalog: shopifyCatalog(store, { cacheDir: './cache' }), // polite: 1 s between pages, 6 h disk cache
  state: new FileStateStore('./data/state'),
  secret: process.env.SHOP_SECRET!,
});
const handler = createMcpHandler(
  // userId must come from something you verified (an OAuth / account-linking token, a signed session),
  // never from a header the client can set. No userId = anonymous: search works, no closet, no orders.
  (ctx) => createShelfServer({ service }, { userId: verifiedShopperId(ctx.requestInfo?.headers.get('authorization')) }),
  { legacy: 'stateless' },
);
// handler.fetch(request) -> Response  (Node, AWS Lambda, Workers)
```

- `verifiedShopperId` is yours to write. Shop Counter has two: an OAuth 2.1 authorization server by the MCP
  Authorization spec, and an HMAC-signed demo session.
- `StateStore` is the storage seam: `FileStateStore`, `MemoryStateStore`, or your own. Shop Counter ships a
  DynamoDB one with conditional writes, so the closet survives across Lambda instances.
- `staticCatalog(store, products)` takes products you already have, for tests or a non-Shopify feed.
- Stateless by design: one fresh `McpServer` per request, so it fits serverless hosts.

## Develop

```bash
npm test          # vitest, 66 tests on synthetic data, no network
npm run typecheck
npm run build     # dist/ for publishing
```

Pinned to the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.3.1) and MCP Apps
(`@modelcontextprotocol/ext-apps` 2.0.3). Clients that ask for 2025-11-25 get 2025-11-25.

## License

MIT. Not affiliated with Shopify, Amazon or any store. Orders are simulated: nothing is bought or charged.
