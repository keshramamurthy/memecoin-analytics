import { Decimal } from 'decimal.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { prisma } from '../config/database.js';
import { redis, redisPublisher } from '../config/redis.js';
import { env } from '../config/env.js';
import { AccountInfo, ParsedAccountData } from '@solana/web3.js';
import {
  ALL_PROGRAM_ID,
  liquidityStateV4Layout,
  struct,
  publicKey,
} from '@raydium-io/raydium-sdk-v2';
import { raydiumApiService } from './raydiumApiService.js';

export interface TokenPriceData {
  tokenMint: string;
  priceUsd: number;
  priceInSol: number;
  marketCap: number;
  totalSupply: number;
  timestamp: number;
}

export class PriceTrackingService {
  private static instance: PriceTrackingService;
  private connection: Connection;
  private solPriceCache: { price: number; timestamp: number } | null = null;
  private readonly SOL_PRICE_CACHE_TTL = 30000; // 30 seconds
  // Removed poolCache - using direct RPC calls now
  private readonly POOL_CACHE_TTL = 300000; // 5 minutes
  
  // Removed axios - using only Solana RPC calls now

  private constructor() {
    // Use Helius RPC endpoint for better performance and reliability
    const heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
    this.connection = new Connection(
      heliusRpcUrl,
      { 
        commitment: 'confirmed', 
        disableRetryOnRateLimit: true,
        httpHeaders: { 'User-Agent': 'memecoin-analytics/1.0' }
      }
    );
  }

  static getInstance(): PriceTrackingService {
    if (!PriceTrackingService.instance) {
      PriceTrackingService.instance = new PriceTrackingService();
    }
    return PriceTrackingService.instance;
  }

  async getTokenPrice(tokenMint: string): Promise<TokenPriceData> {
    // Parallel execution for maximum speed
    const [totalSupply, priceInSol, solPriceUsd] = await Promise.all([
      this.getTokenSupply(tokenMint),
      this.getTokenPriceInSolOptimized(tokenMint),
      this.getSolPriceUsd()
    ]);
    
    // Calculate USD price and market cap
    const priceUsd = priceInSol * solPriceUsd;
    const marketCap = priceUsd * totalSupply;

    const tokenPriceData: TokenPriceData = {
      tokenMint,
      priceUsd,
      priceInSol,
      marketCap,
      totalSupply,
      timestamp: Date.now(),
    };

    return tokenPriceData;
  }

  private async getTokenPriceInSolOptimized(tokenMint: string): Promise<number> {
    try {
      const solMint = 'So11111111111111111111111111111111111111112';
      
      // If token is SOL itself, return 1
      if (tokenMint === solMint) {
        return 1;
      }

      // Check cache first for frequently requested tokens
      const cacheKey = `token_price_sol:${tokenMint}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if ((Date.now() - data.timestamp) < 1000) { // 1 second cache for ultra-fast responses
          return data.price;
        }
      }

      // Try Raydium API first (most reliable)
      try {
        const raydiumPrice = await raydiumApiService.getTokenPriceFromRaydium(tokenMint);
        if (raydiumPrice && raydiumPrice > 0) {
          console.log(`✅ Got price from Raydium API for ${tokenMint}: ${raydiumPrice} SOL`);
          // Cache the result
          await redis.setex(cacheKey, 1, JSON.stringify({ price: raydiumPrice, timestamp: Date.now() }));
          return raydiumPrice;
        }
      } catch (error) {
        console.warn(`Raydium API pricing failed for ${tokenMint}, falling back to RPC`, error);
      }

      // Fallback to direct RPC pool pricing
      try {
        const poolPrice = await this.getTokenPriceFromPool(tokenMint, solMint);
        if (poolPrice > 0) {
          console.log(`✅ Got price from RPC for ${tokenMint}: ${poolPrice} SOL`);
          // Cache the result
          await redis.setex(cacheKey, 1, JSON.stringify({ price: poolPrice, timestamp: Date.now() }));
          return poolPrice;
        }
      } catch (error) {
        console.warn(`RPC pool-based pricing failed for ${tokenMint}`, error);
      }

      // No valid price found
      throw new Error('All pricing methods failed');
      
    } catch (error) {
      console.warn(`Failed to get ${tokenMint}/SOL price:`, error);
      return 0;
    }
  }

  private async getTokenPriceFromPool(tokenMint: string, solMint: string): Promise<number> {
    try {
      // Find pool address using RPC calls
      const poolAddress = await this.findPoolAddress(tokenMint, solMint);
      if (!poolAddress) {
        throw new Error('No pool found');
      }

      // Get pool account data directly from Solana RPC
      const poolAccountInfo = await this.connection.getAccountInfo(new PublicKey(poolAddress));
      if (!poolAccountInfo) {
        throw new Error('Pool account not found');
      }

      // Parse pool data and calculate price
      const price = await this.calculatePriceFromPoolData(poolAccountInfo, tokenMint, solMint);
      
      return price;
    } catch (error) {
      console.warn(`RPC pool pricing failed for ${tokenMint}:`, error);
      throw error;
    }
  }

  private async findPoolAddress(tokenMint: string, solMint: string): Promise<string | null> {
    const cacheKey = `pool_address:${tokenMint}:${solMint}`;
    
    // Skip cache for our target token to force fresh search
    if (tokenMint !== '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump') {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if ((Date.now() - data.timestamp) < this.POOL_CACHE_TTL) {
          return data.address;
        }
      }
    }

    try {
      // Use efficient data slicing to get only baseMint and quoteMint
      const layoutAmm = struct([publicKey('baseMint'), publicKey('quoteMint')]);
      
      console.log(`🔍 Searching for pool: ${tokenMint}/${solMint}`);
      
      // Special debug for the target token
      if (tokenMint === '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump') {
        console.log('🎯 DEBUGGING TARGET TOKEN: 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump');
      }
      
      // Get AMM V4 pools with data slicing for efficiency
      const ammPoolsData = await this.connection.getProgramAccounts(ALL_PROGRAM_ID.AMM_V4, {
        filters: [{ dataSize: liquidityStateV4Layout.span }],
        dataSlice: { offset: liquidityStateV4Layout.offsetOf('baseMint'), length: 64 },
        encoding: 'base64' as any,
      });
      
      console.log(`Found ${ammPoolsData.length} AMM pools to search`);
      
      // Find pool that contains our token pair
      let foundPools = 0;
      for (const account of ammPoolsData) {
        try {
          const poolData = layoutAmm.decode(account.account.data);
          const baseMint = poolData.baseMint.toString();
          const quoteMint = poolData.quoteMint.toString();
          
          // Debug: Check if this pool contains our token
          if (baseMint === tokenMint || quoteMint === tokenMint) {
            foundPools++;
            console.log(`Pool ${foundPools}: ${account.pubkey.toString()} - Base: ${baseMint}, Quote: ${quoteMint}`);
          }
          
          // Check both possible arrangements: token/SOL or SOL/token
          if ((baseMint === tokenMint && quoteMint === solMint) ||
              (baseMint === solMint && quoteMint === tokenMint)) {
            
            const poolAddress = account.pubkey.toString();
            console.log(`✅ Found matching pool: ${poolAddress} (Base: ${baseMint}, Quote: ${quoteMint})`);
            
            // Cache the result
            await redis.setex(cacheKey, 300, JSON.stringify({ 
              address: poolAddress, 
              timestamp: Date.now() 
            }));
            
            return poolAddress;
          }
        } catch (e) {
          // Skip invalid accounts
          continue;
        }
      }
      
      console.log(`Found ${foundPools} pools containing token ${tokenMint}, but none paired with SOL`);
      
      console.log(`No pool found for ${tokenMint}/${solMint}`);
      return null;
    } catch (error) {
      console.warn(`Failed to find pool address for ${tokenMint}/${solMint}:`, error);
      return null;
    }
  }

  private async getFullPoolInfo(poolId: PublicKey): Promise<any> {
    try {
      const data = await this.connection.getAccountInfo(poolId);
      if (!data) throw new Error(`Pool not found: ${poolId.toBase58()}`);
      return liquidityStateV4Layout.decode(data.data);
    } catch (error) {
      console.warn(`Failed to get full pool info for ${poolId.toString()}:`, error);
      return null;
    }
  }

  private async calculatePriceFromPoolData(poolAccountInfo: AccountInfo<Buffer>, tokenMint: string, solMint: string): Promise<number> {
    // Decode the full pool data using SDK v2 layout
    const poolData = liquidityStateV4Layout.decode(poolAccountInfo.data);
    
    const baseMint = poolData.baseMint.toString();
    const quoteMint = poolData.quoteMint.toString();
    
    // Determine which is our token and which is SOL
    const isTokenBase = baseMint === tokenMint;
    const tokenVault = isTokenBase ? poolData.baseVault : poolData.quoteVault;
    const solVault = isTokenBase ? poolData.quoteVault : poolData.baseVault;

    // Get vault balances using RPC
    const [tokenVaultInfo, solVaultInfo, tokenDecimals] = await Promise.all([
      this.connection.getParsedAccountInfo(tokenVault),
      this.connection.getParsedAccountInfo(solVault),
      this.getTokenDecimals(tokenMint)
    ]);

    if (!tokenVaultInfo.value?.data || !solVaultInfo.value?.data) {
      throw new Error('Failed to get vault balances');
    }

    // Extract token amounts from parsed account data
    const tokenVaultData = tokenVaultInfo.value.data as ParsedAccountData;
    const solVaultData = solVaultInfo.value.data as ParsedAccountData;
    
    const tokenReserve = parseFloat(tokenVaultData.parsed.info.tokenAmount.amount);
    const solReserve = parseFloat(solVaultData.parsed.info.tokenAmount.amount);

    // Calculate price: SOL reserve / token reserve (adjusted for decimals)
    const price = (solReserve / Math.pow(10, 9)) / (tokenReserve / Math.pow(10, tokenDecimals));
    
    console.log(`Pool reserves - Token: ${tokenReserve}, SOL: ${solReserve}, Price: ${price}`);
    
    return price;
  }

  // Removed Jupiter API - using only on-chain data

  private async getTokenSupply(tokenMint: string): Promise<number> {
    try {
      // Check Redis cache first with longer TTL
      const cacheKey = `token_supply:${tokenMint}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return parseFloat(cached);
      }

      // Get token supply from Solana RPC with optimized call
      const mintPubkey = new PublicKey(tokenMint);
      const mintInfo = await this.connection.getTokenSupply(mintPubkey, 'confirmed');
      
      if (!mintInfo.value) {
        throw new Error('Failed to get token supply');
      }

      const supply = parseFloat(mintInfo.value.amount) / Math.pow(10, mintInfo.value.decimals);
      
      // Cache for 1 hour (supply rarely changes)
      await redis.setex(cacheKey, 3600, supply.toString());
      
      return supply;
    } catch (error) {
      console.warn(`Failed to get token supply for ${tokenMint}:`, error);
      return 1000000000; // 1B tokens fallback
    }
  }

  private async getTokenDecimals(tokenMint: string): Promise<number> {
    try {
      const cacheKey = `token_decimals:${tokenMint}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return parseInt(cached);
      }

      const mintPubkey = new PublicKey(tokenMint);
      const mintInfo = await this.connection.getTokenSupply(mintPubkey, 'confirmed');
      
      if (!mintInfo.value) {
        throw new Error('Failed to get token mint info');
      }

      const decimals = mintInfo.value.decimals;
      await redis.set(cacheKey, decimals.toString()); // Permanent cache
      
      return decimals;
    } catch (error) {
      console.warn(`Failed to get token decimals for ${tokenMint}:`, error);
      return 9; // Default fallback
    }
  }

  private async getSolPriceUsd(): Promise<number> {
    try {
      const now = Date.now();
      
      // Check Redis cache first for distributed caching
      const cacheKey = 'sol_usd_price';
      const cached = await redis.get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if ((now - data.timestamp) < this.SOL_PRICE_CACHE_TTL) {
          return data.price;
        }
      }

      // Check memory cache
      if (this.solPriceCache && (now - this.solPriceCache.timestamp) < this.SOL_PRICE_CACHE_TTL) {
        return this.solPriceCache.price;
      }

      // Try Raydium API first for SOL price
      try {
        const raydiumSolPrice = await raydiumApiService.getSolPriceUsd();
        if (raydiumSolPrice && raydiumSolPrice > 0) {
          console.log(`✅ Got SOL price from Raydium API: $${raydiumSolPrice}`);
          // Update both caches
          this.solPriceCache = { price: raydiumSolPrice, timestamp: now };
          await redis.setex(cacheKey, 30, JSON.stringify({ price: raydiumSolPrice, timestamp: now }));
          return raydiumSolPrice;
        }
      } catch (error) {
        console.warn('Raydium API SOL price failed, falling back to on-chain:', error);
      }

      // Fallback to on-chain SOL price from USDC/SOL pool
      const price = await this.getSolPriceFromOnChain();
      console.log(`✅ Got SOL price from on-chain: $${price}`);
        
      // Update both caches
      this.solPriceCache = { price, timestamp: now };
      await redis.setex(cacheKey, 30, JSON.stringify({ price, timestamp: now }));
      
      return price;
    } catch (error) {
      console.warn('Failed to get SOL/USD price:', error);
      return 132; // Current approximate SOL price as fallback
    }
  }

  private async getSolPriceFromOnChain(): Promise<number> {
    try {
      // Get SOL price from USDC/SOL pool on-chain
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const solMint = 'So11111111111111111111111111111111111111112';
      
      // Find USDC/SOL pool
      const poolAddress = await this.findPoolAddress(usdcMint, solMint);
      if (!poolAddress) {
        throw new Error('USDC/SOL pool not found');
      }

      // Get pool account data
      const poolAccountInfo = await this.connection.getAccountInfo(new PublicKey(poolAddress));
      if (!poolAccountInfo) {
        throw new Error('Pool account not found');
      }

      // Parse pool data using SDK v2 layout
      const poolData = liquidityStateV4Layout.decode(poolAccountInfo.data);
      
      const baseMint = poolData.baseMint.toString();

      // Determine which vault is USDC and which is SOL
      const isUsdcBase = baseMint === usdcMint;
      const usdcVault = isUsdcBase ? poolData.baseVault : poolData.quoteVault;
      const solVault = isUsdcBase ? poolData.quoteVault : poolData.baseVault;

      // Get vault balances
      const [usdcVaultInfo, solVaultInfo] = await Promise.all([
        this.connection.getParsedAccountInfo(usdcVault),
        this.connection.getParsedAccountInfo(solVault)
      ]);

      if (!usdcVaultInfo.value?.data || !solVaultInfo.value?.data) {
        throw new Error('Failed to get vault balances');
      }

      const usdcVaultData = usdcVaultInfo.value.data as ParsedAccountData;
      const solVaultData = solVaultInfo.value.data as ParsedAccountData;
      
      const usdcReserve = parseFloat(usdcVaultData.parsed.info.tokenAmount.amount);
      const solReserve = parseFloat(solVaultData.parsed.info.tokenAmount.amount);

      // Calculate SOL price in USD: USDC reserve / SOL reserve (adjusted for decimals)
      const solPriceUsd = (usdcReserve / Math.pow(10, 6)) / (solReserve / Math.pow(10, 9));
      
      return solPriceUsd;
    } catch (error) {
      console.warn('On-chain SOL price failed:', error);
      throw error;
    }
  }

  // Removed external API methods - using only on-chain data

  async updateTokenPrice(tokenMint: string): Promise<void> {
    try {
      const priceData = await this.getTokenPrice(tokenMint);
      
      // Use transaction for atomicity and better performance
      await prisma.$transaction(async (tx: any) => {
        // Update current price in database
        await tx.tokenPrice.upsert({
          where: { tokenMint },
          create: {
            tokenMint,
            priceUsd: new Decimal(priceData.priceUsd),
            priceInSol: new Decimal(priceData.priceInSol),
            marketCap: new Decimal(priceData.marketCap),
            totalSupply: new Decimal(priceData.totalSupply),
          },
          update: {
            priceUsd: new Decimal(priceData.priceUsd),
            priceInSol: new Decimal(priceData.priceInSol),
            marketCap: new Decimal(priceData.marketCap),
            totalSupply: new Decimal(priceData.totalSupply),
          },
        });

        // Add to price history
        await tx.priceHistory.create({
          data: {
            tokenMint,
            priceUsd: new Decimal(priceData.priceUsd),
            priceInSol: new Decimal(priceData.priceInSol),
            marketCap: new Decimal(priceData.marketCap),
          },
        });
      });

      // Broadcast price update via Redis pub/sub (fire and forget)
      redisPublisher.publish('price_update', JSON.stringify(priceData)).catch(console.error);

    } catch (error) {
      console.error(`Failed to update price for ${tokenMint}:`, error);
    }
  }

  async getCurrentPrice(tokenMint: string): Promise<TokenPriceData | null> {
    try {
      const tokenPrice = await prisma.tokenPrice.findUnique({
        where: { tokenMint },
      });

      if (!tokenPrice) {
        return null;
      }

      return {
        tokenMint,
        priceUsd: parseFloat(tokenPrice.priceUsd.toString()),
        priceInSol: parseFloat(tokenPrice.priceInSol.toString()),
        marketCap: parseFloat(tokenPrice.marketCap.toString()),
        totalSupply: parseFloat(tokenPrice.totalSupply.toString()),
        timestamp: tokenPrice.lastUpdated.getTime(),
      };
    } catch (error) {
      console.error(`Failed to get current price for ${tokenMint}:`, error);
      return null;
    }
  }

  async getTrackedTokens(): Promise<string[]> {
    try {
      const tokens = await prisma.tokenPrice.findMany({
        select: { tokenMint: true },
        orderBy: { lastUpdated: 'desc' },
      });
      
      return tokens.map((t: any) => t.tokenMint);
    } catch (error) {
      console.error('Failed to get tracked tokens:', error);
      return [];
    }
  }
}

// Export singleton instance
export const priceTrackingService = PriceTrackingService.getInstance();