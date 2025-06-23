# Memecoin Trading Analytics Micro-service

A real-time trading analytics service for Solana memecoins, powered by Helius API and built with TypeScript, Express, Socket.IO, and Redis.

## Features

- Real-time trade ingestion via Helius REST API polling
- WebSocket broadcasts for live updates
- Advanced metrics calculation (market cap, token velocity, concentration ratio, paperhand ratio)
- REST API endpoints for historical data
- Prometheus metrics for monitoring
- Docker containerization with Redis caching

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Helius API key

### Installation

1. Clone the repository
2. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
3. Update `.env` with your Helius API key
4. Start with Docker Compose:
   ```bash
   docker-compose up -d
   ```

### Development

Install dependencies:
```bash
npm ci
```

Generate Prisma client:
```bash
npm run db:generate
npm run db:push
```

Start development server:
```bash
npm run dev
```

Start polling worker:
```bash
npm run worker
```

### API Endpoints

- `GET /health` - Health check
- `GET /tokens` - List tracked tokens
- `GET /tokens/:mint/metrics?window=1m|5m|1h` - Token metrics
- `GET /tokens/:mint/holders/top?limit=10` - Top holders
- `GET /tokens/:mint/trades?limit=100&before=<timestamp>` - Trade history
- `GET /metrics` - Prometheus metrics

### WebSocket

Connect to `/ws` namespace with query parameter `token=<mint>` to receive real-time updates:
- `trade` events for new trades
- `metrics` events for metric updates

### Testing

Run tests:
```bash
npm test
```

Run load tests:
```bash
k6 run k6/test.js
```

### Build & Deploy

Build for production:
```bash
npm run build
npm start
```

Build Docker image:
```bash
docker build -t memecoin-analytics .
```

## Architecture

- **Express API**: REST endpoints and middleware
- **Socket.IO**: Real-time WebSocket communication
- **BullMQ**: Job queue for polling coordination
- **Prisma**: Database ORM with SQLite
- **Redis**: Caching and pub/sub messaging
- **Prometheus**: Metrics collection and monitoring

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | HTTP server port | 8080 |
| DATABASE_URL | SQLite database path | file:./prisma/dev.db |
| REDIS_URL | Redis connection URL | redis://cache:6379 |
| HELIUS_API_KEY | Helius API key | required |
| POLL_MS | Polling interval in milliseconds | 2000 |