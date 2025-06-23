# Claude Code Prompt – Trojan Trading Analytics Micro‑service  
*(TypeScript · Socket.IO · SQLite · REST‑only ingestion)*

Copy **everything** below (inside the triple‑back‑tick block) into a Claude Code session.  
Claude will output the entire TypeScript repository in one shot.

```
You are Claude Code, an expert TypeScript back‑end engineer.

### Mission
Build a **Memecoin Trading Analytics micro‑service** for the Solana DEX *Trojan*, powered by the **public‑tier Helius REST APIs** (no LaserStream / gRPC).  
Return the full project as multi‑file code blocks (see “Output format”).

### Hard Requirements
1. **Language / runtime**  
   • TypeScript (Node 20 LTS)

2. **Frameworks & Libraries**  
   • HTTP server – Express 4  
   • Real‑time – Socket.IO  
   • Data fetch – `axios` (or `undici` fetch API) for Helius REST polling  
   • Task scheduler – `bullmq` backed by Redis to orchestrate polling jobs  
   • ORM – Prisma targeting **SQLite** (file `./prisma/dev.db`)  
   • Cache & pub/sub – Redis via `ioredis`  
   • Validation – Zod  
   • Tests – Vitest + supertest  
   • Load‑test demo – k6

3. **Containerisation**  
   • Multi‑stage `Dockerfile` building the API/worker image  
   • `docker-compose.yml` services:  
     – `api` (this service)  
     – `cache` (Redis)  
   • SQLite DB file stored in a named volume (`dbdata`).

4. **REST Endpoints (JSON)**  
   GET `/health` → 200 OK  
   GET `/tokens` → paginated list of tracked tokens  
   GET `/tokens/:mint/metrics?window=1m|5m|1h`  
   GET `/tokens/:mint/holders/top?limit=10`  
   GET `/tokens/:mint/trades?limit=100&before=<timestamp>`

5. **Socket.IO namespace `/ws`**  
   • Client connects with query `token=<mint>`  
   • Server emits messages:  
     – `trade`  `{ slot, … }` (each trade)  
     – `metrics` `{ marketCap, … }` (when any metric changes)

6. **Metrics (sliding windows, recalc every blockTime)**  
   • `marketCap`  = lastPrice × totalSupply (lastPrice = VWAP of last 20 trades)  
   • `tokenVelocity` = transfers in window ÷ circulatingSupply  
   • `concentrationRatio` = top‑10 holders’ balance ÷ circulatingSupply  
   • `paperhandRatio` = volume sold by addresses that held < 24h ÷ total volume (24h)  
   Implement pure helpers in `src/services/metricService.ts`; keep incremental SQL & Redis cache.

7. **Ingestion Pipeline (REST‑only)**  
   • For every tracked token mint, enqueue a **polling job** (BullMQ) that runs every `POLL_MS` (default 2000 ms).  
   • Each job hits Helius **Enhanced Transactions API**  
     `GET /v0/addresses/{tokenMint}/transactions?api-key=...&limit=200&before=<sig>`  
     to retrieve SPL `TRANSFER` transactions newer than the last stored slot.  
   • Parse transfers involving the mint, compute USD price via Trojanswap pool price endpoint, persist trades in SQLite, update Redis caches, broadcast to Socket.IO.  
   • If the API rate‑limit (HTTP 429) is hit, apply exponential back‑off with ceiling.

8. **Prisma Schema (`prisma/schema.prisma`)**

```prisma
datasource db {{
  provider = "sqlite"
  url      = "file:./dev.db"
}}

generator client {{
  provider = "prisma-client-js"
}}

model Trade {{
  id         BigInt  @id @default(autoincrement())
  txSig      String  @unique
  slot       BigInt
  blockTime  DateTime
  tokenMint  String  @index
  buyer      String
  seller     String
  amount     Decimal
  priceUsd   Decimal
}}

model HolderSnapshot {{
  id         BigInt  @id @default(autoincrement())
  tokenMint  String  @index
  holder     String
  balance    Decimal
  capturedAt DateTime @index
}}

model Metric {{
  tokenMint           String   @id
  marketCap           Decimal
  tokenVelocity       Decimal
  concentrationRatio  Decimal
  paperhandRatio      Decimal
  updatedAt           DateTime @updatedAt
}}
```

9. **Environment variables (`.env.example`)**

```
PORT=8080
DATABASE_URL=file:./prisma/dev.db
REDIS_URL=redis://cache:6379
HELIUS_API_KEY=replace_me
POLL_MS=2000
```

10. **Other Must‑haves**  
    • Strict `tsconfig.json`  
    • ESLint + Prettier + Husky pre‑commit  
    • `README.md` with run / build / test / load‑test examples  
    • `k6/test.js` hitting `/tokens/<mint>/metrics` with 500 VUs for 30 s  
    • GitHub Actions CI: lint, test, build Docker, upload image artifact  
    • Prometheus metrics endpoint `/metrics` (http & custom counters)  
    • `src/ingest/pollerWorker.ts` runs in its own process (`npm run worker`) and schedules BullMQ jobs per mint; uses Redis pub/sub to fan out events.  
    • Extract types to `src/types/*.ts`; controllers remain thin; favour async/await.

### Output format
For each file, start a fenced block whose first line is **exact relative path**, then the code, e.g.:

```
// package.json
{ … }
```

List **every** file required so the repo builds with `npm ci && npm run build`.

### Style preferences
Idiomatic modern TS (ES2022 modules). Keep business logic in services; use Zod for request validation & env parsing.

### Deliverable
Return **only code blocks**, no prose.  
Ensure `tsc --noEmit` passes, all tests green (`vitest`), and `docker-compose up -d` starts successfully.

ultrathink here
```
