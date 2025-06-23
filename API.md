# Memecoin Trading Analytics API Documentation

A high-performance micro-service for real-time Solana memecoin price tracking and analytics.

## Base URL
```
http://localhost:3305
```

## Authentication
No authentication required for public endpoints.

---

## REST API Endpoints

### Health Check
Check if the API is running and healthy.

**GET** `/health`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### Get All Tracked Tokens
Retrieve a paginated list of all tracked tokens with their current price data.

**GET** `/tokens`

**Query Parameters:**
- `page` (optional, number): Page number (default: 1)
- `limit` (optional, number): Items per page (default: 20, max: 100)

**Example:**
```
GET /tokens?page=1&limit=10
```

**Response:**
```json
{
  "data": [
    {
      "mint": "71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg",
      "priceUsd": 0.033051,
      "priceInSol": 0.00025,
      "marketCap": 33051000,
      "totalSupply": 1000000000,
      "lastUpdated": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 150,
    "totalPages": 15
  }
}
```

---

### Get Token Metrics
Get current price and market metrics for a specific token. If the token is not tracked, it will be automatically discovered and tracked.

**GET** `/tokens/:mint/metrics`

**Path Parameters:**
- `mint` (required, string): Token mint address

**Query Parameters:**
- `window` (optional, string): Time window for metrics calculation
  - `1m` - 1 minute
  - `5m` - 5 minutes  
  - `1h` - 1 hour (default)

**Example:**
```
GET /tokens/71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg/metrics?window=5m
```

**Response:**
```json
{
  "tokenMint": "71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg",
  "priceUsd": 0.033051,
  "priceInSol": 0.00025,
  "marketCap": 33051000,
  "totalSupply": 1000000000,
  "lastUpdated": 1705312200000,
  "window": "5m"
}
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

**GET** `/metrics`

**Response:**
```
# HELP polling_jobs_total Total number of polling jobs processed
# TYPE polling_jobs_total counter
polling_jobs_total{token_mint="71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg",status="success"} 1500
```

---

## WebSocket API

### Connection
Connect to the WebSocket namespace for real-time price updates.

**Endpoint:** `/ws`

**Connection URL:**
```
ws://localhost:8080/ws?token=<TOKEN_MINT>
```

**Query Parameters:**
- `token` (required, string): Token mint address to subscribe to

### Events

#### Connection Success
Emitted immediately after successful connection with initial token data.

**Event:** `price_update`
```json
{
  "tokenMint": "71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg",
  "priceUsd": 0.033051,
  "priceInSol": 0.00025,
  "marketCap": 33051000,
  "totalSupply": 1000000000,
  "timestamp": 1705312200000
}
```

#### Real-time Price Updates
Emitted every second when token price changes.

**Event:** `price_update`
```json
{
  "tokenMint": "71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg",
  "priceUsd": 0.033070,
  "priceInSol": 0.000251,
  "marketCap": 33070000,
  "totalSupply": 1000000000,
  "timestamp": 1705312201000
}
```

#### Connection Errors
Emitted when there's an error with the connection or token discovery.

**Event:** `error`
```json
{
  "message": "Token parameter is required"
}
```

### Example WebSocket Client (JavaScript)
```javascript
import { io } from 'socket.io-client';

const socket = io('ws://localhost:8080/ws', {
  query: {
    token: '71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg'
  }
});

socket.on('price_update', (data) => {
  console.log('Price update:', data);
});

socket.on('error', (error) => {
  console.error('WebSocket error:', error);
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

## Performance Features

### Auto-Discovery
Tokens are automatically discovered and tracked when first requested via any endpoint.

### Aggressive Caching
- Token prices: 1-second cache for ultra-fast responses
- Token supply: 1-hour cache (rarely changes)
- Pool information: 5-minute cache
- SOL price: 30-second cache

### Optimizations
- **Singleton Pattern**: Single service instance prevents duplicate price calls
- **Parallel Execution**: Multiple data sources fetched concurrently  
- **Pool-based Pricing**: Direct Raydium pool queries for speed
- **Helius RPC**: Premium Solana RPC endpoint for reliability
- **Redis Pub/Sub**: Efficient WebSocket broadcasting

### Rate Limits
- Price updates: Every 1 second per token
- WebSocket connections: Unlimited (uses rooms for efficiency)
- REST API: No explicit limits (relies on caching)

---

## Load Testing

Use the included k6 script to test API performance:

```bash
k6 run k6/load-test.js
```

**Test Scenario:**
- 500 concurrent virtual users
- 30-second peak load
- Mixed endpoint testing
- 95th percentile response time < 1000ms
- Error rate < 5%

---

## Token Examples

**Popular Test Tokens:**
- `71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg` - Test memecoin
- `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` - USDC
- `So11111111111111111111111111111111111111112` - Wrapped SOL

---

## Architecture

- **Express.js** - HTTP server
- **Socket.IO** - WebSocket real-time communication  
- **BullMQ** - Job queue for 1-second price polling
- **Prisma** - ORM with SQLite database
- **Redis** - Caching and pub/sub messaging
- **Helius** - Solana RPC provider
- **Raydium SDK** - Direct pool price calculation