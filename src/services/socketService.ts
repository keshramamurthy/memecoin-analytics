import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { redisSubscriber } from '../config/redis.js';
import { priceTrackingService, TokenPriceData } from './priceTrackingService.js';
import { addTokenForTracking } from '../ingest/pollerWorker.js';
import { tokenValidationService } from './tokenValidationService.js';

interface SocketSubscriptions {
  subscriptions: Set<string>;
}

export class SocketService {
  private io: SocketIOServer;
  private socketSubscriptions = new WeakMap<Socket, SocketSubscriptions>();

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
      console.log(`WebSocket connection established: ${socket.id}`);
      
      // Initialize subscriptions for this socket
      this.socketSubscriptions.set(socket, { subscriptions: new Set() });
      
      // Send welcome message
      socket.emit('connected', { 
        message: 'Connected to token analytics WebSocket',
        socketId: socket.id,
        usage: 'Send "tokenMint,subscribe" to subscribe or "tokenMint,unsubscribe" to unsubscribe'
      });

      // Handle subscription messages
      socket.on('message', async (data) => {
        await this.handleSubscriptionMessage(socket, data);
      });

      // Handle legacy query parameter token (for backwards compatibility)
      const legacyToken = socket.handshake.query.token as string;
      if (legacyToken) {
        console.log(`Legacy token subscription detected: ${legacyToken}`);
        await this.subscribeToToken(socket, legacyToken);
      }
      
      socket.on('disconnect', () => {
        console.log(`WebSocket disconnected: ${socket.id}`);
        this.handleDisconnection(socket);
      });
    });
  }

  private async handleSubscriptionMessage(socket: Socket, data: any): Promise<void> {
    try {
      const message = typeof data === 'string' ? data : data.toString();
      console.log(`Received message from ${socket.id}: ${message}`);
      
      // Parse message format: "tokenMint,action"
      const [tokenMint, action] = message.split(',').map((s: string) => s.trim());
      
      if (!tokenMint || !action) {
        socket.emit('error', { 
          message: 'Invalid message format. Use "tokenMint,subscribe" or "tokenMint,unsubscribe"' 
        });
        return;
      }

      switch (action.toLowerCase()) {
        case 'subscribe':
          await this.subscribeToToken(socket, tokenMint);
          break;
        case 'unsubscribe':
          await this.unsubscribeFromToken(socket, tokenMint);
          break;
        default:
          socket.emit('error', { 
            message: `Unknown action: ${action}. Use "subscribe" or "unsubscribe"` 
          });
      }
    } catch (error) {
      console.error(`Error handling subscription message:`, error);
      socket.emit('error', { 
        message: 'Failed to process subscription message' 
      });
    }
  }

  private async subscribeToToken(socket: Socket, tokenMint: string): Promise<void> {
    try {
      // Validate token mint first
      const validation = await tokenValidationService.validateTokenMint(tokenMint);
      if (!validation.isValid) {
        console.log(`Subscription rejected: invalid token ${tokenMint} - ${validation.reason}`);
        socket.emit('subscription_error', { 
          tokenMint,
          message: `Invalid token mint: ${validation.reason}`,
          code: 'INVALID_TOKEN_MINT'
        });
        return;
      }

      const subscriptions = this.socketSubscriptions.get(socket);
      if (!subscriptions) {
        socket.emit('error', { message: 'Socket not properly initialized' });
        return;
      }

      // Check if already subscribed
      if (subscriptions.subscriptions.has(tokenMint)) {
        socket.emit('subscription_status', { 
          tokenMint,
          status: 'already_subscribed',
          message: `Already subscribed to ${tokenMint}` 
        });
        return;
      }

      // Add to subscriptions
      subscriptions.subscriptions.add(tokenMint);
      
      // Join room for this token
      const room = `token:${tokenMint}`;
      socket.join(room);

      console.log(`Socket ${socket.id} subscribed to token: ${tokenMint}`);

      // Auto-discover and track the token for price updates
      try {
        console.log(`Auto-discovering validated token: ${tokenMint}`);
        
        // Check if token is already tracked
        let tokenData = await priceTrackingService.getCurrentPrice(tokenMint);
        
        if (!tokenData) {
          // Get initial price data
          tokenData = await priceTrackingService.getTokenPrice(tokenMint);
          
          // Update database with new token
          await priceTrackingService.updateTokenPrice(tokenMint);
          
          // Add token to price tracking worker
          await addTokenForTracking(tokenMint);
          
          console.log(`Token ${tokenMint} added for price tracking`);
        } else {
          console.log(`Token ${tokenMint} already being tracked`);
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

        // Confirm subscription
        socket.emit('subscription_success', { 
          tokenMint,
          message: `Successfully subscribed to ${tokenMint}`,
          totalSubscriptions: subscriptions.subscriptions.size
        });
        
      } catch (error) {
        console.error(`Error discovering token ${tokenMint}:`, error);
        
        // Remove from subscriptions on error
        subscriptions.subscriptions.delete(tokenMint);
        socket.leave(room);
        
        socket.emit('subscription_error', { 
          tokenMint,
          message: 'Failed to discover token' 
        });
      }
    } catch (error) {
      console.error(`Error subscribing to token ${tokenMint}:`, error);
      socket.emit('subscription_error', { 
        tokenMint,
        message: 'Failed to subscribe to token' 
      });
    }
  }

  private async unsubscribeFromToken(socket: Socket, tokenMint: string): Promise<void> {
    try {
      const subscriptions = this.socketSubscriptions.get(socket);
      if (!subscriptions) {
        socket.emit('error', { message: 'Socket not properly initialized' });
        return;
      }

      // Check if subscribed
      if (!subscriptions.subscriptions.has(tokenMint)) {
        socket.emit('unsubscription_status', { 
          tokenMint,
          status: 'not_subscribed',
          message: `Not subscribed to ${tokenMint}` 
        });
        return;
      }

      // Remove from subscriptions
      subscriptions.subscriptions.delete(tokenMint);
      
      // Leave room for this token
      const room = `token:${tokenMint}`;
      socket.leave(room);

      console.log(`Socket ${socket.id} unsubscribed from token: ${tokenMint}`);

      // Confirm unsubscription
      socket.emit('unsubscription_success', { 
        tokenMint,
        message: `Successfully unsubscribed from ${tokenMint}`,
        totalSubscriptions: subscriptions.subscriptions.size
      });
    } catch (error) {
      console.error(`Error unsubscribing from token ${tokenMint}:`, error);
      socket.emit('unsubscription_error', { 
        tokenMint,
        message: 'Failed to unsubscribe from token' 
      });
    }
  }

  private handleDisconnection(socket: Socket): void {
    const subscriptions = this.socketSubscriptions.get(socket);
    if (subscriptions) {
      console.log(`Socket ${socket.id} disconnected with ${subscriptions.subscriptions.size} active subscriptions`);
      
      // Leave all rooms
      for (const tokenMint of subscriptions.subscriptions) {
        const room = `token:${tokenMint}`;
        socket.leave(room);
      }
      
      // Clean up subscriptions
      this.socketSubscriptions.delete(socket);
    }
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
    // Include market cap in real-time price updates
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