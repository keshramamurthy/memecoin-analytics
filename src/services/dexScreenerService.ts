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
  private readonly CACHE_TTL = 5; // 5 second cache
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
        // Use single token API for better pair selection (gets all pairs, not just primary)
        const batchResults: BatchTokenPriceResult[] = [];
        for (const tokenMint of batch) {
          try {
            const singleResult = await this.fetchSingleTokenPrice(tokenMint);
            if (singleResult) {
              batchResults.push(singleResult);
            }
            await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
          } catch (error) {
            console.warn(`Failed to fetch ${tokenMint}:`, error);
          }
        }
        
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
    
    console.log(`🔬 processPairsResponse: ${pairs.length} pairs received, ${requestedTokens.length} tokens requested`);
    pairs.forEach(p => console.log(`  Received pair: ${p.dexId} - $${p.priceUsd} (${p.baseToken.address}/${p.quoteToken.address})`));
    
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
    console.log(`📊 Processing ${tokenPairsMap.size} tokens from DexScreener response`);
    for (const [tokenMint, tokenPairs] of tokenPairsMap) {
      console.log(`🎯 Processing token ${tokenMint}: ${tokenPairs.length} pairs found`);
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
    console.log(`🔍 Selecting best pair for ${tokenMint}: ${pairs.length} pairs available`);
    pairs.forEach(p => console.log(`  Available: ${p.dexId} - $${p.priceUsd} (L: $${p.liquidity?.usd || 0})`));
    
    if (pairs.length === 0) return null;
    if (pairs.length === 1) {
      console.log(`⚠️  Only 1 pair available, using: ${pairs[0]?.dexId}`);
      return pairs[0] || null;
    }
    
    const solMint = 'So11111111111111111111111111111111111111112';
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const wsolMint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
    
    // Filter out low-quality pairs (launchpad pools, very low liquidity)
    const MIN_LIQUIDITY_USD = 500; // Minimum $500 liquidity
    const MIN_VOLUME_24H = 100; // Minimum $100 volume in 24h
    
    console.log(`\n🔍 Filtering ${pairs.length} pairs for token ${tokenMint}:`);
    const qualityPairs = pairs.filter(p => {
      const liquidityUsd = p.liquidity?.usd || 0;
      const volume24h = p.volume?.['24h'] || 0;
      
      console.log(`  ${p.dexId}: L=$${liquidityUsd.toFixed(2)} V=$${volume24h.toFixed(2)} Price=$${p.priceUsd}`);
      
      // Be very strict with suspected launchpad/pump pools first
      const dexIdLower = p.dexId.toLowerCase();
      const isLaunchpad = dexIdLower.includes('pump') || 
                         dexIdLower.includes('launch') ||
                         dexIdLower.includes('lab') ||
                         dexIdLower === 'launchlab' ||
                         p.pairAddress.includes('pump');
      
      if (isLaunchpad) {
        // Require substantial trading activity for launchpad pools
        const hasHighVolume = volume24h > 1000; // $1k+ volume
        const hasHighLiquidity = liquidityUsd > 5000; // $5k+ liquidity
        
        if (!hasHighVolume || !hasHighLiquidity) {
          console.log(`    ❌ Filtering out launchpad ${p.dexId}: V=$${volume24h} L=$${liquidityUsd}`);
          return false;
        }
      }
      
      // For established DEXes, be more lenient with volume requirements
      const isEstablishedDex = ['raydium', 'orca', 'jupiter', 'meteora'].some(dex => 
        p.dexId.toLowerCase().includes(dex)
      );
      
      if (isEstablishedDex) {
        // Only require minimum liquidity for established DEXes (allow zero volume)
        if (liquidityUsd < MIN_LIQUIDITY_USD) {
          console.log(`Filtering out established DEX ${p.dexId}: low liquidity $${liquidityUsd}`);
          return false;
        }
      } else {
        // For unknown DEXes, require both volume and liquidity
        if (volume24h < MIN_VOLUME_24H || liquidityUsd < MIN_LIQUIDITY_USD) {
          console.log(`Filtering out unknown DEX ${p.dexId}: V=$${volume24h} L=$${liquidityUsd}`);
          return false;
        }
      }
      
      return true;
    });
    
    if (qualityPairs.length === 0) {
      console.warn(`No quality pairs found for ${tokenMint}, using highest liquidity available`);
      return pairs.reduce((best, current) => 
        (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
      );
    }
    
    // Prioritize established DEXes (Raydium, Orca, Jupiter)
    const establishedDexes = ['raydium', 'orca', 'jupiter', 'aldrin', 'saber'];
    let establishedPairs = qualityPairs.filter(p => 
      establishedDexes.some(dex => p.dexId.toLowerCase().includes(dex))
    );
    
    // If no established DEX pairs, use all quality pairs
    if (establishedPairs.length === 0) {
      establishedPairs = qualityPairs;
    }
    
    // Priority: SOL pairs > USDC pairs > highest liquidity within established DEXes
    let solPairs = establishedPairs.filter(p => 
      (p.baseToken.address === tokenMint && (p.quoteToken.address === solMint || p.quoteToken.address === wsolMint)) ||
      ((p.baseToken.address === solMint || p.baseToken.address === wsolMint) && p.quoteToken.address === tokenMint)
    );
    
    if (solPairs.length > 0) {
      const bestSolPair = solPairs.reduce((best, current) => {
        const currentScore = this.calculatePairScore(current);
        const bestScore = this.calculatePairScore(best);
        return currentScore > bestScore ? current : best;
      });
      console.log(`Selected SOL pair for ${tokenMint}: ${bestSolPair.dexId} with $${bestSolPair.liquidity?.usd?.toLocaleString() || 0} liquidity`);
      return bestSolPair;
    }
    
    let usdcPairs = establishedPairs.filter(p => 
      (p.baseToken.address === tokenMint && p.quoteToken.address === usdcMint) ||
      (p.baseToken.address === usdcMint && p.quoteToken.address === tokenMint)
    );
    
    if (usdcPairs.length > 0) {
      const bestUsdcPair = usdcPairs.reduce((best, current) => {
        const currentScore = this.calculatePairScore(current);
        const bestScore = this.calculatePairScore(best);
        return currentScore > bestScore ? current : best;
      });
      console.log(`Selected USDC pair for ${tokenMint}: ${bestUsdcPair.dexId} with $${bestUsdcPair.liquidity?.usd?.toLocaleString() || 0} liquidity`);
      return bestUsdcPair;
    }
    
    // Return highest scoring pair from established DEXes
    const bestPair = establishedPairs.reduce((best, current) => {
      const currentScore = this.calculatePairScore(current);
      const bestScore = this.calculatePairScore(best);
      return currentScore > bestScore ? current : best;
    });
    
    console.log(`Selected best pair for ${tokenMint}: ${bestPair.dexId} with $${bestPair.liquidity?.usd?.toLocaleString() || 0} liquidity`);
    return bestPair;
  }
  
  private calculatePairScore(pair: DexScreenerPair): number {
    const liquidityUsd = pair.liquidity?.usd || 0;
    const volume24h = pair.volume?.['24h'] || 0;
    const txnsBuys = pair.txns?.['24h']?.buys || 0;
    const txnsSells = pair.txns?.['24h']?.sells || 0;
    const totalTxns = txnsBuys + txnsSells;
    
    // Adjusted scoring: prioritize trading activity over pure liquidity
    const liquidityScore = liquidityUsd * 0.3; // Reduced from 70%
    const volumeScore = volume24h * 0.4; // Increased from 20%
    const txnScore = totalTxns * 200 * 0.3; // Increased from 10% and higher weight
    
    // Strong bonus for established DEXes (prefer even with lower liquidity)
    const establishedDexes = ['raydium', 'orca', 'jupiter'];
    const dexBonus = establishedDexes.some(dex => pair.dexId.toLowerCase().includes(dex)) ? 50000 : 0;
    
    // Heavy penalty for pump.fun and launchpad pools (they trap liquidity)
    let launchpadPenalty = 0;
    if (pair.dexId.toLowerCase().includes('pump') || 
        pair.dexId.toLowerCase().includes('launch') ||
        pair.pairAddress.includes('pump')) {
      // Heavy penalty unless it has massive volume indicating real trading
      launchpadPenalty = volume24h > 100000 ? -10000 : -100000; // $100k+ volume needed
    }
    
    // Bonus for pairs with good volume-to-liquidity ratio (active trading)
    const volumeToLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
    const activityBonus = volumeToLiquidityRatio > 0.1 ? 15000 : 0; // 10%+ turnover rate
    
    // Bonus for recent trading activity
    const recentActivityBonus = totalTxns > 50 ? 5000 : 0; // 50+ transactions in 24h
    
    const finalScore = liquidityScore + volumeScore + txnScore + dexBonus + launchpadPenalty + activityBonus + recentActivityBonus;
    
    console.log(`Pair ${pair.dexId} score: ${finalScore.toFixed(0)} (L:${liquidityScore.toFixed(0)} V:${volumeScore.toFixed(0)} T:${txnScore.toFixed(0)} DEX:${dexBonus} LP:${launchpadPenalty} A:${activityBonus})`);
    
    return finalScore;
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