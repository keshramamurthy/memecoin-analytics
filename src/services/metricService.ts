import { Connection, PublicKey } from '@solana/web3.js';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { SOL_TOTAL_SUPPLY } from '../config/constants.js';
import { tokenValidationService } from './tokenValidationService.js';
import { rugCheckService, RugCheckData } from './rugCheckService.js';

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
}

export interface TokenMetricsResult {
  tokenMint: string;
  name: string;
  symbol: string;
  totalSupply: number;
  priceUsd: number;
  priceInSol: number;
  marketCap: number;
  concentrationRatio: number; // Top 10 holders % of supply
  lastUpdated: string;
  rugCheck?: {
    score_normalised: number;
    risks: Array<{
      name: string;
      value: string;
      description: string;
      score: number;
      level: 'info' | 'warn' | 'danger';
    }>;
    rugged: boolean;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskSummary: {
      totalRisks: number;
      highRisks: number;
      mediumRisks: number;
      lowRisks: number;
    };
  };
}

export interface HolderBalance {
  address: string;
  balance: number;
  percentage: number;
}

export class MetricService {
  private static instance: MetricService;
  private connection: Connection;

  private constructor() {
    const heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
    this.connection = new Connection(heliusRpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
    });
  }

  static getInstance(): MetricService {
    if (!MetricService.instance) {
      MetricService.instance = new MetricService();
    }
    return MetricService.instance;
  }

  async getTokenInfo(tokenMint: string): Promise<TokenInfo> {
    // Validate token first
    const validation =
      await tokenValidationService.validateTokenMint(tokenMint);
    if (!validation.isValid) {
      throw new Error(`Invalid token mint: ${validation.reason}`);
    }

    // Check cache first
    const cacheKey = `token_info:${tokenMint}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      // For SOL, return special values
      if (tokenMint === 'So11111111111111111111111111111111111111112') {
        const solInfo: TokenInfo = {
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
          totalSupply: SOL_TOTAL_SUPPLY,
        };
        await redis.setex(cacheKey, 3600, JSON.stringify(solInfo)); // Cache for 1 hour
        return solInfo;
      }

      // Get token metadata from Helius API
      const metadataResponse = await fetch(
        `https://api.helius.xyz/v0/token-metadata?api-key=${env.HELIUS_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mintAccounts: [tokenMint],
          }),
        }
      );

      if (!metadataResponse.ok) {
        throw new Error('Failed to fetch token metadata');
      }

      const metadataData = await metadataResponse.json();
      const tokenMetadata = metadataData[0];

      // Get token supply info
      const mintPubkey = new PublicKey(tokenMint);
      const mintInfo = await this.connection.getTokenSupply(
        mintPubkey,
        'confirmed'
      );

      if (!mintInfo.value) {
        throw new Error('Failed to get token supply');
      }

      const tokenInfo: TokenInfo = {
        name:
          tokenMetadata?.onChainMetadata?.metadata?.data?.name ||
          'Unknown Token',
        symbol:
          tokenMetadata?.onChainMetadata?.metadata?.data?.symbol || 'UNKNOWN',
        decimals: mintInfo.value.decimals,
        totalSupply:
          parseFloat(mintInfo.value.amount) /
          Math.pow(10, mintInfo.value.decimals),
      };

      // Cache for 1 hour (token info rarely changes)
      await redis.setex(cacheKey, 3600, JSON.stringify(tokenInfo));

      return tokenInfo;
    } catch (error) {
      console.warn(`Failed to get token info for ${tokenMint}:`, error);
      // Return fallback data
      const fallbackInfo: TokenInfo = {
        name: 'Unknown Token',
        symbol: 'UNKNOWN',
        decimals: 9,
        totalSupply: 1000000000, // 1B tokens fallback
      };
      return fallbackInfo;
    }
  }

  async getTopHolders(
    tokenMint: string,
    limit: number = 10
  ): Promise<HolderBalance[]> {
    // Validate token first
    const validation =
      await tokenValidationService.validateTokenMint(tokenMint);
    if (!validation.isValid) {
      throw new Error(`Invalid token mint: ${validation.reason}`);
    }

    // Check cache first
    const cacheKey = `top_holders:${tokenMint}:${limit}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      // Use Helius RPC method getTokenLargestAccounts
      const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;

      const holdersResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'getTokenLargestAccounts',
          params: [tokenMint],
        }),
      });

      if (!holdersResponse.ok) {
        throw new Error('Failed to fetch token holders');
      }

      const holdersData = await holdersResponse.json();

      if (holdersData.error) {
        throw new Error(`RPC error: ${holdersData.error.message}`);
      }

      const tokenInfo = await this.getTokenInfo(tokenMint);

      // Parse the largest accounts data
      const holders: HolderBalance[] =
        holdersData.result?.value?.slice(0, limit).map((account: any) => {
          const balance = account.uiAmount || 0;
          const percentage =
            tokenInfo.totalSupply > 0
              ? (balance / tokenInfo.totalSupply) * 100
              : 0;

          return {
            address: account.address,
            balance,
            percentage,
          };
        }) || [];

      // Cache for 5 minutes (holder data changes frequently)
      await redis.setex(cacheKey, 300, JSON.stringify(holders));

      return holders;
    } catch (error) {
      console.warn(`Failed to get top holders for ${tokenMint}:`, error);
      return [];
    }
  }

  async calculateConcentrationRatio(tokenMint: string): Promise<number> {
    try {
      // Get top 10 holders
      const topHolders = await this.getTopHolders(tokenMint, 10);

      // Calculate total percentage held by top 10
      const concentrationRatio = topHolders.reduce(
        (sum, holder) => sum + holder.percentage,
        0
      );

      return Math.min(concentrationRatio, 100); // Cap at 100%
    } catch (error) {
      console.warn(
        `Failed to calculate concentration ratio for ${tokenMint}:`,
        error
      );
      return 0;
    }
  }

  async getTokenMetrics(
    tokenMint: string,
    _window: '1m' | '5m' | '1h' = '1h'
  ): Promise<TokenMetricsResult> {
    // Validate token first
    const validation =
      await tokenValidationService.validateTokenMint(tokenMint);
    if (!validation.isValid) {
      throw new Error(`Invalid token mint: ${validation.reason}`);
    }

    // Get all data in parallel for better performance
    const [tokenInfo, currentPrice, concentrationRatio, rugCheckData] =
      await Promise.all([
        this.getTokenInfo(tokenMint),
        this.getCurrentPrice(tokenMint),
        this.calculateConcentrationRatio(tokenMint),
        rugCheckService.getTokenRugCheck(tokenMint),
      ]);

    const result: TokenMetricsResult = {
      tokenMint,
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      totalSupply: tokenInfo.totalSupply,
      priceUsd: currentPrice?.priceUsd || 0,
      priceInSol: currentPrice?.priceInSol || 0,
      marketCap: currentPrice?.marketCap || 0,
      concentrationRatio,
      lastUpdated: new Date().toISOString(),
    };

    // Add RugCheck data if available
    if (rugCheckData) {
      result.rugCheck = {
        score_normalised: rugCheckData.score_normalised,
        risks: rugCheckData.risks,
        rugged: rugCheckData.rugged,
        riskLevel: rugCheckService.getOverallRiskLevel(
          rugCheckData.score_normalised,
          rugCheckData.rugged
        ),
        riskSummary: rugCheckService.getRiskSummary(rugCheckData.risks),
      };
    }

    return result;
  }

  private async getCurrentPrice(tokenMint: string) {
    try {
      const tokenPrice = await prisma.tokenPrice.findUnique({
        where: { tokenMint },
      });

      if (!tokenPrice) {
        return null;
      }

      return {
        priceUsd: parseFloat(tokenPrice.priceUsd.toString()),
        priceInSol: parseFloat(tokenPrice.priceInSol.toString()),
        marketCap: parseFloat(tokenPrice.marketCap.toString()),
      };
    } catch (error) {
      console.error(`Failed to get current price for ${tokenMint}:`, error);
      return null;
    }
  }
}

export const metricService = MetricService.getInstance();
