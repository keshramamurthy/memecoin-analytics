import axios from 'axios';
import { redis } from '../config/redis.js';

export interface RaydiumPoolInfo {
  id: string;
  mintA: {
    address: string;
    decimals: number;
  };
  mintB: {
    address: string;
    decimals: number;
  };
  price: number;
  liquidity: number;
  volume24h: number;
}

export interface RaydiumApiResponse {
  success: boolean;
  data: {
    data: RaydiumPoolInfo[];
    hasNextPage: boolean;
  };
}

export class RaydiumApiService {
  private static instance: RaydiumApiService;
  private readonly baseUrl = 'https://api-v3.raydium.io/pools/info/mint';
  private readonly solMint = 'So11111111111111111111111111111111111111112';
  private readonly usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  private readonly CACHE_TTL = 300; // 5 minutes

  private constructor() {}

  static getInstance(): RaydiumApiService {
    if (!RaydiumApiService.instance) {
      RaydiumApiService.instance = new RaydiumApiService();
    }
    return RaydiumApiService.instance;
  }

  async findTokenPool(tokenMint: string): Promise<RaydiumPoolInfo | null> {
    try {
      // Check cache first
      const cacheKey = `raydium_pool:${tokenMint}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Try to find pool with SOL first (most common for memecoins)
      let pool = await this.getPoolFromApi(tokenMint, this.solMint);
      
      // If no SOL pool found, try USDC
      if (!pool) {
        pool = await this.getPoolFromApi(tokenMint, this.usdcMint);
      }

      if (pool) {
        // Cache the result
        await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(pool));
      }

      return pool;
    } catch (error) {
      console.warn(`Failed to find pool for token ${tokenMint}:`, error);
      return null;
    }
  }

  private async getPoolFromApi(mint1: string, mint2: string): Promise<RaydiumPoolInfo | null> {
    try {
      const url = `${this.baseUrl}?mint1=${mint1}&mint2=${mint2}&poolType=all&poolSortField=default&sortType=desc&pageSize=1&page=1`;
      
      console.log(`🔍 Querying Raydium API: ${mint1}/${mint2}`);
      
      const response = await axios.get<RaydiumApiResponse>(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'memecoin-analytics/1.0',
        },
      });

      if (response.data.success && response.data.data.data.length > 0) {
        const pool = response.data.data.data[0];
        if (pool) {
          console.log(`✅ Found pool via Raydium API: ${pool.id} - Price: ${pool.price}`);
          return pool;
        }
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.warn(`Raydium API error for ${mint1}/${mint2}:`, {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
      } else {
        console.warn(`Failed to query Raydium API for ${mint1}/${mint2}:`, error);
      }
      return null;
    }
  }

  async getTokenPriceFromRaydium(tokenMint: string): Promise<number | null> {
    try {
      const pool = await this.findTokenPool(tokenMint);
      if (!pool) {
        return null;
      }

      // Determine which mint is our token and calculate price accordingly
      const isTokenMintA = pool.mintA.address === tokenMint;
      let priceInQuote = pool.price;

      // If token is mintB, we need to invert the price
      if (!isTokenMintA) {
        priceInQuote = 1 / pool.price;
      }

      // If paired with USDC, convert to SOL price
      if ((isTokenMintA && pool.mintB.address === this.usdcMint) ||
          (!isTokenMintA && pool.mintA.address === this.usdcMint)) {
        // Get SOL/USDC price to convert USDC price to SOL price
        const solUsdcPool = await this.getPoolFromApi(this.solMint, this.usdcMint);
        if (solUsdcPool) {
          const solPriceInUsdc = solUsdcPool.mintA.address === this.solMint ? 
            solUsdcPool.price : 1 / solUsdcPool.price;
          priceInQuote = priceInQuote / solPriceInUsdc; // Convert USDC price to SOL price
        }
      }

      return priceInQuote;
    } catch (error) {
      console.warn(`Failed to get token price from Raydium for ${tokenMint}:`, error);
      return null;
    }
  }

  async getSolPriceUsd(): Promise<number | null> {
    try {
      // Check cache first
      const cacheKey = 'raydium_sol_usd_price';
      const cached = await redis.get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if ((Date.now() - data.timestamp) < 30000) { // 30 second cache
          return data.price;
        }
      }

      const pool = await this.getPoolFromApi(this.solMint, this.usdcMint);
      if (!pool) {
        return null;
      }

      // Calculate SOL price in USD
      const solPriceUsd = pool.mintA.address === this.solMint ? 
        pool.price : 1 / pool.price;

      // Cache the result
      await redis.setex(cacheKey, 30, JSON.stringify({ 
        price: solPriceUsd, 
        timestamp: Date.now() 
      }));

      return solPriceUsd;
    } catch (error) {
      console.warn('Failed to get SOL price from Raydium:', error);
      return null;
    }
  }
}

export const raydiumApiService = RaydiumApiService.getInstance();