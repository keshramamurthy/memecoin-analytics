import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { redisSubscriber } from '../config/redis.js';
import { priceTrackingService, TokenPriceData } from './priceTrackingService.js';
import { addTokenForTracking } from '../ingest/pollerWorker.js';
import { tokenValidationService } from './tokenValidationService.js';

export class SocketService {
  private io: SocketIOServer;

  constructor(httpServer: HttpServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupNamespace();
    this.setupRedisSubscription();
  }

  private setupNamespace(): void {
    const wsNamespace = this.io.of('/ws');

    wsNamespace.on('connection', async (socket) => {
      const token = socket.handshake.query.token as string;
      
      if (!token) {
        console.log('WebSocket connection rejected: no token provided');
        socket.emit('error', { message: 'Token parameter is required' });
        socket.disconnect();
        return;
      }

      console.log(`WebSocket connection for token: ${token}`);

      // Validate token mint first
      const validation = await tokenValidationService.validateTokenMint(token);
      if (!validation.isValid) {
        console.log(`WebSocket connection rejected: invalid token ${token} - ${validation.reason}`);
        socket.emit('error', { 
          message: `Invalid token mint: ${validation.reason}`,
          code: 'INVALID_TOKEN_MINT'
        });
        socket.disconnect();
        return;
      }

      const room = `token:${token}`;
      socket.join(room);

      // Auto-discover and track the token for price updates
      try {
        console.log(`Auto-discovering validated token: ${token}`);
        
        // Check if token is already tracked
        let tokenData = await priceTrackingService.getCurrentPrice(token);
        
        if (!tokenData) {
          // Get initial price data
          tokenData = await priceTrackingService.getTokenPrice(token);
          
          // Update database with new token
          await priceTrackingService.updateTokenPrice(token);
          
          // Add token to price tracking worker
          await addTokenForTracking(token);
          
          console.log(`Token ${token} added for price tracking`);
        } else {
          console.log(`Token ${token} already being tracked`);
        }
        
        // Send initial price data to the client
        socket.emit('price_update', {
          tokenMint: tokenData.tokenMint,
          priceUsd: tokenData.priceUsd,
          priceInSol: tokenData.priceInSol,
          marketCap: tokenData.marketCap,
          totalSupply: tokenData.totalSupply,
          timestamp: tokenData.timestamp,
        });
        
      } catch (error) {
        console.error(`Error discovering token ${token}:`, error);
        socket.emit('error', { message: 'Failed to discover token' });
      }
      
      socket.on('disconnect', () => {
        console.log(`WebSocket disconnected for token: ${token}`);
        socket.leave(room);
      });
    });
  }

  private setupRedisSubscription(): void {
    redisSubscriber.subscribe('price_update');

    redisSubscriber.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        
        if (channel === 'price_update') {
          this.broadcastPriceUpdate(data as TokenPriceData);
        }
      } catch (error) {
        console.error('Error processing Redis message:', error);
      }
    });
  }

  private broadcastPriceUpdate(priceData: TokenPriceData): void {
    const room = `token:${priceData.tokenMint}`;
    this.io.of('/ws').to(room).emit('price_update', {
      tokenMint: priceData.tokenMint,
      priceUsd: priceData.priceUsd,
      priceInSol: priceData.priceInSol,
      marketCap: priceData.marketCap,
      totalSupply: priceData.totalSupply,
      timestamp: priceData.timestamp,
    });
  }
}