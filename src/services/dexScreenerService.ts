import axios from 'axios';
import { redis } from '../config/redis.js';

export interface DexScreenerToken {
  address: string;
  name: string;
  symbol: string;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: DexScreenerToken;
  quoteToken: DexScreenerToken;
  priceNative: string;
  priceUsd: string;
  txns?: {
    [key: string]: {
      buys: number;
      sells: number;
    };
  };
  volume?: {
    [key: string]: number;
  };
  priceChange?: {
    [key: string]: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ url: string }>;
    socials?: Array<{ platform: string; handle: string }>;
  };
  boosts?: {
    active: number;
  };
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

export interface BatchTokenPriceResult {
  tokenMint: string;
  priceUsd: number;
  priceInSol: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  pairAddress: string;
  dexId: string;
}

export class DexScreenerService {
  private static instance: DexScreenerService;
  private readonly baseUrl = 'https://api.dexscreener.com';
  private readonly chainId = 'solana';
  private readonly CACHE_TTL = 60; // 1 minute cache
  private readonly BATCH_SIZE = 30; // DexScreener allows up to 30 addresses per request
  private readonly RATE_LIMIT_DELAY = 200; // 200ms between requests (5 req/sec max)
  private lastRequestTime = 0;

  private constructor() {}

  static getInstance(): DexScreenerService {
    if (!DexScreenerService.instance) {
      DexScreenerService.instance = new DexScreenerService();
    }
    return DexScreenerService.instance;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      const delay = this.RATE_LIMIT_DELAY - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  async getTokenPrice(tokenMint: string): Promise<BatchTokenPriceResult | null> {
    const results = await this.getBatchTokenPrices([tokenMint]);
    return results.length > 0 ? results[0] || null : null;
  }

  async getBatchTokenPrices(tokenMints: string[]): Promise<BatchTokenPriceResult[]> {
    if (tokenMints.length === 0) return [];

    const results: BatchTokenPriceResult[] = [];
    const uncachedTokens: string[] = [];
    
    // Check cache first for each token
    for (const tokenMint of tokenMints) {
      const cacheKey = `dexscreener_price:${tokenMint}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        const data = JSON.parse(cached);
        if ((Date.now() - data.timestamp) < this.CACHE_TTL * 1000) {
          results.push(data.result);
          continue;
        }
      }
      
      uncachedTokens.push(tokenMint);
    }

    if (uncachedTokens.length === 0) {
      return results;
    }

    // Process uncached tokens in batches
    const batches = this.chunkArray(uncachedTokens, this.BATCH_SIZE);
    
    for (const batch of batches) {
      try {
        await this.rateLimit();
        const batchResults = await this.fetchBatchPrices(batch);
        
        // Cache each result
        for (const result of batchResults) {
          const cacheKey = `dexscreener_price:${result.tokenMint}`;
          await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify({
            result,
            timestamp: Date.now()
          }));
        }
        
        results.push(...batchResults);
      } catch (error) {
        console.warn(`Failed to fetch batch prices for tokens:`, batch, error);
        
        // If batch fails, try individual requests with exponential backoff
        for (const tokenMint of batch) {
          try {
            await this.rateLimit();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Extra delay for individual retries
            const singleResult = await this.fetchSingleTokenPrice(tokenMint);
            if (singleResult) {
              results.push(singleResult);
              
              // Cache single result
              const cacheKey = `dexscreener_price:${tokenMint}`;
              await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify({
                result: singleResult,
                timestamp: Date.now()
              }));
            }
          } catch (singleError) {
            console.warn(`Failed to fetch single token price for ${tokenMint}:`, singleError);
          }
        }
      }
    }

    return results;
  }

  private async fetchBatchPrices(tokenMints: string[]): Promise<BatchTokenPriceResult[]> {
    const tokenAddresses = tokenMints.join(',');
    const url = `${this.baseUrl}/tokens/v1/${this.chainId}/${tokenAddresses}`;
    
    console.log(`🔍 Fetching batch prices from DexScreener: ${tokenMints.length} tokens`);
    
    const response = await axios.get<DexScreenerPair[]>(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'memecoin-analytics/1.0',
        'Accept': 'application/json',
      },
    });

    return this.processPairsResponse(response.data, tokenMints);
  }

  private async fetchSingleTokenPrice(tokenMint: string): Promise<BatchTokenPriceResult | null> {
    const url = `${this.baseUrl}/token-pairs/v1/${this.chainId}/${tokenMint}`;
    
    console.log(`🔍 Fetching single token price from DexScreener: ${tokenMint}`);
    
    try {
      const response = await axios.get<DexScreenerPair[]>(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'memecoin-analytics/1.0',
          'Accept': 'application/json',
        },
      });

      const results = this.processPairsResponse(response.data, [tokenMint]);
      return results.length > 0 ? results[0] || null : null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          console.warn(`Rate limited by DexScreener, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          throw error;
        }
      }
      throw error;
    }
  }

  private processPairsResponse(pairs: DexScreenerPair[], requestedTokens: string[]): BatchTokenPriceResult[] {
    const results: BatchTokenPriceResult[] = [];
    
    // Group pairs by token mint for processing
    const tokenPairsMap = new Map<string, DexScreenerPair[]>();
    
    for (const pair of pairs) {
      const baseAddress = pair.baseToken.address;
      const quoteAddress = pair.quoteToken.address;
      
      // Check if this pair contains any of our requested tokens
      for (const tokenMint of requestedTokens) {
        if (baseAddress === tokenMint || quoteAddress === tokenMint) {
          if (!tokenPairsMap.has(tokenMint)) {
            tokenPairsMap.set(tokenMint, []);
          }
          tokenPairsMap.get(tokenMint)!.push(pair);
        }
      }
    }
    
    // Process each token's pairs
    for (const [tokenMint, tokenPairs] of tokenPairsMap) {
      // Find the best pair for this token (prefer SOL pairs, then USDC, then highest liquidity)
      const bestPair = this.selectBestPair(tokenPairs, tokenMint);
      
      if (bestPair) {
        const result = this.convertPairToResult(bestPair, tokenMint);
        if (result) {
          results.push(result);
          console.log(`✅ DexScreener price for ${tokenMint}: $${result.priceUsd} (${result.priceInSol} SOL)`);
        }
      }
    }
    
    return results;
  }

  private selectBestPair(pairs: DexScreenerPair[], tokenMint: string): DexScreenerPair | null {
    if (pairs.length === 0) return null;
    if (pairs.length === 1) return pairs[0] || null;
    
    const solMint = 'So11111111111111111111111111111111111111112';
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    
    // Priority: SOL pairs > USDC pairs > highest liquidity
    let solPairs = pairs.filter(p => 
      (p.baseToken.address === tokenMint && p.quoteToken.address === solMint) ||
      (p.baseToken.address === solMint && p.quoteToken.address === tokenMint)
    );
    
    if (solPairs.length > 0) {
      return solPairs.reduce((best, current) => 
        (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
      );
    }
    
    let usdcPairs = pairs.filter(p => 
      (p.baseToken.address === tokenMint && p.quoteToken.address === usdcMint) ||
      (p.baseToken.address === usdcMint && p.quoteToken.address === tokenMint)
    );
    
    if (usdcPairs.length > 0) {
      return usdcPairs.reduce((best, current) => 
        (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
      );
    }
    
    // Return highest liquidity pair
    return pairs.reduce((best, current) => 
      (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
    );
  }

  private convertPairToResult(pair: DexScreenerPair, tokenMint: string): BatchTokenPriceResult | null {
    try {
      const priceUsd = parseFloat(pair.priceUsd);
      
      if (isNaN(priceUsd) || priceUsd <= 0) {
        console.warn(`Invalid USD price for ${tokenMint}:`, pair.priceUsd);
        return null;
      }

      // Calculate SOL price by getting current SOL/USD rate
      const priceInSol = parseFloat(pair.priceNative);
      
      return {
        tokenMint,
        priceUsd,
        priceInSol: isNaN(priceInSol) ? priceUsd / 132.5 : priceInSol, // Fallback calculation
        marketCap: pair.marketCap || 0,
        liquidity: pair.liquidity?.usd || 0,
        volume24h: pair.volume?.['24h'] || 0,
        pairAddress: pair.pairAddress,
        dexId: pair.dexId,
      };
    } catch (error) {
      console.warn(`Failed to convert pair to result for ${tokenMint}:`, error);
      return null;
    }
  }

  async getSolPriceUsd(): Promise<number> {
    try {
      // Check cache first
      const cacheKey = 'dexscreener_sol_usd_price';
      const cached = await redis.get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if ((Date.now() - data.timestamp) < 30000) { // 30 second cache
          return data.price;
        }
      }

      await this.rateLimit();
      
      const solMint = 'So11111111111111111111111111111111111111112';
      const url = `${this.baseUrl}/token-pairs/v1/${this.chainId}/${solMint}`;
      
      const response = await axios.get<DexScreenerPair[]>(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'memecoin-analytics/1.0',
        },
      });

      // Find SOL/USDC pair
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const solUsdcPair = response.data.find(pair => 
        (pair.baseToken.address === solMint && pair.quoteToken.address === usdcMint) ||
        (pair.baseToken.address === usdcMint && pair.quoteToken.address === solMint)
      );

      if (solUsdcPair) {
        let solPriceUsd: number;
        
        if (solUsdcPair.baseToken.address === solMint) {
          solPriceUsd = parseFloat(solUsdcPair.priceUsd);
        } else {
          // If USDC is base token, SOL price is the inverse
          solPriceUsd = 1 / parseFloat(solUsdcPair.priceUsd);
        }

        // Cache the result
        await redis.setex(cacheKey, 30, JSON.stringify({ 
          price: solPriceUsd, 
          timestamp: Date.now() 
        }));

        return solPriceUsd;
      }

      throw new Error('SOL/USDC pair not found in DexScreener');
    } catch (error) {
      console.warn('Failed to get SOL price from DexScreener:', error);
      return 132.5; // Fallback price
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

export const dexScreenerService = DexScreenerService.getInstance();