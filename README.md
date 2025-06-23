# Memecoin Trading Analytics Platform

A comprehensive real-time analytics platform for Solana memecoins with intelligent pool selection, security analysis, and live WebSocket streaming. Built with TypeScript, Express, Socket.IO, and optimized for production Docker deployment.

## 🚀 Features

### Core Analytics
- **Intelligent Pool Selection**: Automatically selects optimal DEX pools (Raydium, Orca) over launchpads for accurate pricing
- **Real-time Price Streaming**: WebSocket updates every 3 seconds with DexScreener API integration
- **Advanced Metrics**: Market cap, token velocity, concentration ratio, holder analysis
- **Security Analysis**: Integrated RugCheck API for token risk assessment and fraud detection

### Platform Features
- **Interactive Web Dashboard**: Dark mode UI with real-time charts and metrics
- **REST API**: Comprehensive endpoints for historical data and analytics
- **WebSocket Streaming**: Live price updates and metric broadcasts
- **Production Ready**: Full Docker containerization with health checks
- **Monitoring**: Prometheus metrics and structured logging

## 🎯 One-Click Setup

### Prerequisites
- Docker & Docker Compose
- Helius API key

### Quick Start
```bash
# Clone and setup
git clone <repository>
cd permissionless-hack

# Configure environment
echo "HELIUS_API_KEY=your_api_key_here" >> .env

# One-click deployment
./setup.sh
```

Access your platform:
- **Dashboard**: http://localhost:3305
- **Health Check**: http://localhost:3305/api/health
- **WebSocket**: ws://localhost:3305/ws

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

## 📡 API Reference

### REST Endpoints
- `GET /api/health` - Health check with database/Redis status
- `GET /api/tokens` - List all tracked tokens
- `GET /api/tokens/:mint/metrics` - Comprehensive token analytics with RugCheck data
- `GET /api/tokens/:mint/holders/top?limit=10` - Top token holders
- `GET /api/tokens/:mint/trades?limit=100&before=<timestamp>` - Trade history
- `GET /api/metrics` - Prometheus metrics

### WebSocket Streaming
Connect to `/ws` namespace:
```javascript
const socket = io('ws://localhost:3305/ws');
socket.emit('subscribe', { tokenMint: 'your_token_mint' });
socket.on('priceUpdate', (data) => console.log(data));
```

Events:
- `priceUpdate` - Real-time price and market cap updates (every 3s)
- `metricsUpdate` - Updated analytics including RugCheck scores
- `trade` - New trade notifications

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

## 🏗️ Architecture

### Technology Stack
- **Frontend**: Vanilla JS dashboard with Socket.IO client, dark mode UI
- **Backend**: Express.js API with TypeScript, comprehensive error handling  
- **Real-time**: Socket.IO WebSocket streaming with subscription management
- **Database**: Prisma ORM with SQLite, optimized queries
- **Caching**: Redis with 3-second TTL for responsive price updates
- **Containerization**: Multi-stage Docker builds, Alpine Linux production images
- **Monitoring**: Prometheus metrics, structured logging, health checks

### Key Services
- **DexScreener Service**: Intelligent pool selection prioritizing established DEXes
- **RugCheck Service**: Token security analysis and risk scoring  
- **Price Tracking**: Real-time WebSocket price streaming every 3 seconds
- **Metrics Service**: Advanced analytics with concentration ratios and holder analysis

## 🐳 Docker Deployment

### Environment Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| PORT | HTTP server port | 3305 |
| DATABASE_URL | SQLite database path | file:./prisma/dev.db |
| REDIS_URL | Redis connection URL | redis://cache:6379 |
| HELIUS_API_KEY | Helius API key | **required** |
| POLL_MS | Polling interval in milliseconds | 2000 |

### Production Commands
```bash
# Full restart with clean volumes
docker-compose down --volumes && ./setup.sh

# View live logs
docker-compose logs -f

# Scale services
docker-compose up --scale api=2
```

## 🛠️ Development Setup

Local development without Docker:
```bash
npm ci
npm run db:generate
npm run db:push
npm run dev        # API server
npm run worker:dev # Background worker
```

The platform supports both standalone development and full containerized deployment for production use.