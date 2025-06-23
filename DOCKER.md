# 🐳 Docker Setup Guide

This guide helps you run the Memecoin Analytics system using Docker.

## 📋 Prerequisites

- Docker and Docker Compose installed
- Helius API key ([get one here](https://helius.xyz/))

## 🚀 Quick Start

1. **Clone and navigate to the project:**
   ```bash
   git clone <repository>
   cd permissionless-hack
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.docker .env
   # Edit .env and add your HELIUS_API_KEY
   ```

3. **Run the automated test:**
   ```bash
   ./docker-test.sh
   ```

## 🔧 Manual Setup

1. **Build and start services:**
   ```bash
   docker-compose up -d
   ```

2. **Check health:**
   ```bash
   curl http://localhost:3305/api/health
   ```

3. **Access the dashboard:**
   Open http://localhost:3305 in your browser

## 📊 Services

- **API + Dashboard**: `localhost:3305`
- **Redis Cache**: `localhost:6379`

## 🛠️ Docker Architecture

### Services:
- **api**: Main Node.js application with TypeScript
- **cache**: Redis for caching DexScreener data

### Features:
- ✅ **UI Dashboard**: Served at root path
- ✅ **REST API**: All endpoints under `/api/`
- ✅ **WebSocket**: Real-time price updates at `/ws`
- ✅ **RugCheck Integration**: Security analysis for tokens
- ✅ **Optimized Pool Selection**: Chooses best DEX pools
- ✅ **Health Checks**: Container monitoring
- ✅ **Volume Persistence**: Database and Redis data

### Ports:
- `3305`: Main application (dashboard + API)
- `6379`: Redis cache

## 🔍 Troubleshooting

### View logs:
```bash
docker-compose logs -f api
docker-compose logs -f cache
```

### Restart services:
```bash
docker-compose restart
```

### Reset everything:
```bash
docker-compose down -v
docker-compose up -d
```

### Test specific endpoints:
```bash
# Health check
curl http://localhost:3305/api/health

# Token metrics with RugCheck
curl "http://localhost:3305/api/tokens/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump/metrics"

# API info
curl http://localhost:3305/api/dashboard/info
```

## 🎯 API Endpoints

- `GET /`: Dashboard UI
- `GET /api/health`: System health
- `GET /api/tokens`: List tracked tokens
- `GET /api/tokens/:mint/metrics`: Comprehensive token analysis
- `GET /api/tokens/:mint/holders/top`: Top token holders
- `GET /api/tokens/:mint/history`: Price history
- `WS /ws`: Real-time price updates

## 🛡️ Security Features

- **RugCheck Integration**: Automated security analysis
- **Risk Scoring**: 0-100 safety score
- **Risk Level Assessment**: Low/Medium/High/Critical
- **Detailed Risk Reports**: Specific security issues identified

## 🔄 Development

For development with auto-reload:
```bash
# Stop production containers
docker-compose down

# Run in development mode
npm install
npm run dev
```

## 📝 Environment Variables

Required in `.env`:
```env
HELIUS_API_KEY=your_helius_api_key_here
PORT=3305
DATABASE_URL=file:./prisma/dev.db
REDIS_URL=redis://cache:6379
POLL_MS=2000
```