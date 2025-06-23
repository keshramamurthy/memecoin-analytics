# Memecoin Analytics Platform - API Documentation

A comprehensive real-time analytics platform for Solana memecoins with intelligent pool selection, security analysis, and live WebSocket streaming.

## Base URL
```
http://localhost:3305
```

## Dashboard
Interactive web dashboard available at: **http://localhost:3305**

## Authentication
No authentication required for public endpoints.

---

## REST API Endpoints

### Health Check
Check if the API is running and healthy with database/Redis connectivity.

**GET** `/api/health`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-06-23T20:19:25.807Z",
  "database": "connected",
  "redis": "connected"
}
```

---

### Get All Tracked Tokens
Retrieve a list of all currently tracked tokens with their latest price data.

**GET** `/api/tokens`

**Response:**
```json
{
  "tokens": [
    {
      "mint": "9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray",
      "name": "ChillWifSwifties2FartDegenBonk69",
      "symbol": "Degen69",
      "priceUsd": 0.00003612949500000001,
      "marketCap": 36129.47503218205,
      "lastUpdated": "2025-06-23T20:19:38.955Z"
    }
  ]
}
```

---

### Get Comprehensive Token Metrics
Get detailed analytics for a specific token including price data, security analysis, and holder metrics.

**GET** `/api/tokens/:mint/metrics`

**Path Parameters:**
- `mint` (required, string): Token mint address

**Example:**
```
GET /api/tokens/9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray/metrics
```

**Response:**
```json
{
  "tokenMint": "9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray",
  "name": "ChillWifSwifties2FartDegenBonk69",
  "symbol": "Degen69",
  "totalSupply": 999999141.47509,
  "priceUsd": 0.00003612949500000001,
  "priceInSol": 2.589e-7,
  "marketCap": 36129.47503218205,
  "concentrationRatio": 53.36272376908713,
  "lastUpdated": "2025-06-23T20:19:38.955Z",
  "rugCheck": {
    "score_normalised": 16,
    "risks": [
      {
        "name": "Low amount of LP Providers",
        "description": "Only a few users are providing liquidity",
        "score": 500,
        "level": "warn"
      }
    ],
    "rugged": false,
    "riskLevel": "high",
    "riskSummary": {
      "totalRisks": 1,
      "highRisks": 0,
      "mediumRisks": 1,
      "lowRisks": 0
    }
  }
}
```

---

### Get Top Token Holders
Retrieve the largest holders for a specific token.

**GET** `/api/tokens/:mint/holders/top`

**Query Parameters:**
- `limit` (optional, number): Maximum number of holders to return (default: 10, max: 50)

**Example:**
```
GET /api/tokens/9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray/holders/top?limit=5
```

---

### Get Trade History
Retrieve recent trade history for a specific token.

**GET** `/api/tokens/:mint/trades`

**Query Parameters:**
- `limit` (optional, number): Maximum number of trades to return (default: 100, max: 1000)
- `before` (optional, timestamp): Get trades before this timestamp

**Example:**
```
GET /api/tokens/9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray/trades?limit=50
```

---

### Get Token Price History
Retrieve historical price data for a specific token within a time window.

**GET** `/tokens/:mint/history`

**Path Parameters:**
- `mint` (required, string): Token mint address

**Query Parameters:**
- `window` (optional, string): Time window for history
  - `1m` - Last 1 minute
  - `5m` - Last 5 minutes
  - `1h` - Last 1 hour (default)

**Example:**
```
GET /tokens/71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg/history?window=1h
```

**Response:**
```json
{
  "data": [
    {
      "priceUsd": 0.033051,
      "priceInSol": 0.00025,
      "marketCap": 33051000,
      "timestamp": "2024-01-15T10:30:00.000Z"
    },
    {
      "priceUsd": 0.033070,
      "priceInSol": 0.000251,
      "marketCap": 33070000,
      "timestamp": "2024-01-15T10:30:01.000Z"
    }
  ],
  "window": "1h",
  "total": 3600
}
```

---

### Prometheus Metrics
Get Prometheus-compatible metrics for monitoring.

**GET** `/api/metrics`

**Response:**
```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/health",status_code="200"} 150
```

---

## WebSocket API

### Connection
Connect to the WebSocket server for real-time price updates using subscription model.

**Endpoint:** `/ws`

**Connection URL:**
```
ws://localhost:3305/ws
```

### Subscription Model

#### Subscribe to Token Updates
Subscribe to real-time updates for a specific token.

**Emit:** `subscribe`
```json
{
  "tokenMint": "9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray"
}
```

#### Unsubscribe from Token Updates
Stop receiving updates for a specific token.

**Emit:** `unsubscribe`
```json
{
  "tokenMint": "9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray"
}
```

### Events

#### Real-time Price Updates
Emitted every 3 seconds with current price data for subscribed tokens.

**Event:** `priceUpdate`
```json
{
  "tokenMint": "9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray",
  "name": "ChillWifSwifties2FartDegenBonk69",
  "symbol": "Degen69",
  "priceUsd": 0.00003612949500000001,
  "priceInSol": 2.589e-7,
  "marketCap": 36129.47503218205,
  "timestamp": "2025-06-23T20:19:38.955Z"
}
```

#### Metrics Updates
Emitted when comprehensive token metrics are updated (includes RugCheck data).

**Event:** `metricsUpdate`
```json
{
  "tokenMint": "9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray",
  "concentrationRatio": 53.36272376908713,
  "rugCheck": {
    "score_normalised": 16,
    "riskLevel": "high",
    "rugged": false
  },
  "timestamp": "2025-06-23T20:19:38.955Z"
}
```

#### New Trade Notifications
Emitted when new trades are detected for subscribed tokens.

**Event:** `trade`
```json
{
  "tokenMint": "9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray",
  "type": "buy",
  "amount": 1000000,
  "priceUsd": 0.00003612949500000001,
  "timestamp": "2025-06-23T20:19:38.955Z"
}
```

### Example WebSocket Client (JavaScript)
```javascript
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3305/ws');

// Subscribe to token updates
socket.emit('subscribe', {
  tokenMint: '9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray'
});

// Listen for price updates
socket.on('priceUpdate', (data) => {
  console.log('Price update:', data);
});

// Listen for metrics updates
socket.on('metricsUpdate', (data) => {
  console.log('Metrics update:', data);
});

// Listen for trade notifications
socket.on('trade', (data) => {
  console.log('New trade:', data);
});

// Handle connection status
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from WebSocket server');
});
```

---

## Error Responses

All endpoints return standard HTTP status codes:

- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (token not found)
- `500` - Internal Server Error

**Error Response Format:**
```json
{
  "error": "Error message describing what went wrong"
}
```

---

## Key Features

### Intelligent Pool Selection
- **DexScreener Integration**: Automatically selects optimal DEX pools (Raydium, Orca) over launchpads
- **Liquidity Prioritization**: Chooses pools with highest liquidity for accurate pricing
- **Multi-DEX Support**: Covers all major Solana DEXes with smart scoring algorithm

### Security Analysis
- **RugCheck Integration**: Real-time token security analysis and risk scoring
- **Risk Assessment**: Comprehensive fraud detection and risk categorization
- **Safety Metrics**: Tracks LP provider count, token holder distribution, and other security indicators

### Performance Optimizations
- **3-Second Cache TTL**: Responsive price updates every 3 seconds
- **Redis Caching**: Intelligent caching strategy for different data types
- **Parallel Processing**: Concurrent API calls for optimal performance
- **WebSocket Rooms**: Efficient subscription management for real-time updates

### Production Features
- **Docker Containerization**: Multi-stage builds with Alpine Linux
- **Health Monitoring**: Database and Redis connectivity checks
- **Prometheus Metrics**: Comprehensive monitoring and observability
- **Error Handling**: Robust error recovery and logging

---

## Load Testing

Use the included k6 script to test API performance:

```bash
k6 run k6/comprehensive-load-test.js
```

**Test Scenarios:**
- Multi-endpoint stress testing
- WebSocket connection load testing
- Database performance validation
- Error rate monitoring

---

## Example Usage

### Test Token
```
9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray
```

### Quick Test Commands
```bash
# Health check
curl http://localhost:3305/api/health

# Get token metrics with RugCheck analysis
curl http://localhost:3305/api/tokens/9yS8Bocd5geSqyY7hp9MeXmnfBNYw8nuw8rZFQeHEray/metrics

# View dashboard
open http://localhost:3305
```

---

## Architecture

### Technology Stack
- **Express.js** - HTTP API server with TypeScript
- **Socket.IO** - Real-time WebSocket communication with subscription management
- **Prisma ORM** - Database layer with SQLite for development
- **Redis** - Caching and pub/sub messaging (3-second TTL for responsive updates)
- **DexScreener API** - Intelligent pool selection and price data
- **RugCheck API** - Token security analysis and risk assessment
- **Docker** - Multi-stage containerization with production optimization

### Core Services
- **DexScreener Service**: Optimal pool selection prioritizing established DEXes
- **RugCheck Service**: Token security analysis and fraud detection
- **Price Tracking Service**: Real-time price monitoring with 3-second intervals
- **Metrics Service**: Advanced analytics including concentration ratios and holder analysis
- **Socket Service**: WebSocket subscription management and broadcasting