import axios from 'axios';
import { redis } from '../config/redis.js';

export interface RugCheckRisk {
  name: string;
  value: string;
  description: string;
  score: number;
  level: 'info' | 'warn' | 'danger';
}

export interface RugCheckData {
  mint: string;
  score_normalised: number;
  risks: RugCheckRisk[];
  rugged: boolean;
  price?: number;
  totalHolders?: number;
  transferFee?: {
    pct: number;
    maxAmount: number;
    authority: string;
  };
}

export class RugCheckService {
  private static instance: RugCheckService;
  private readonly baseUrl = 'https://api.rugcheck.xyz/v1';
  private readonly CACHE_TTL = 300; // 5 minutes cache for rug check data

  public static getInstance(): RugCheckService {
    if (!RugCheckService.instance) {
      RugCheckService.instance = new RugCheckService();
    }
    return RugCheckService.instance;
  }

  async getTokenRugCheck(tokenMint: string): Promise<RugCheckData | null> {
    const cacheKey = `rugcheck:${tokenMint}`;

    try {
      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        const age = Date.now() - data.timestamp;

        if (age < this.CACHE_TTL * 1000) {
          console.log(`📋 Cached RugCheck data for ${tokenMint}`);
          return data.result;
        }
      }
    } catch (error) {
      console.warn(`Cache error for RugCheck ${tokenMint}:`, error);
    }

    try {
      console.log(`🔍 Fetching RugCheck data for ${tokenMint}`);

      const response = await axios.get(
        `${this.baseUrl}/tokens/${tokenMint}/report`,
        {
          timeout: 10000,
          headers: {
            'User-Agent': 'memecoin-analytics/1.0',
            Accept: 'application/json',
          },
        }
      );

      if (!response.data) {
        console.warn(`No RugCheck data returned for ${tokenMint}`);
        return null;
      }

      const rugCheckData: RugCheckData = {
        mint: response.data.mint,
        score_normalised: response.data.score_normalised || 0,
        risks: response.data.risks || [],
        rugged: response.data.rugged || false,
        price: response.data.price,
        totalHolders: response.data.totalHolders,
        transferFee: response.data.transferFee,
      };

      // Cache the result
      try {
        await redis.setex(
          cacheKey,
          this.CACHE_TTL,
          JSON.stringify({
            result: rugCheckData,
            timestamp: Date.now(),
          })
        );
      } catch (cacheError) {
        console.warn(
          `Failed to cache RugCheck data for ${tokenMint}:`,
          cacheError
        );
      }

      console.log(
        `✅ RugCheck data fetched for ${tokenMint}: Score ${rugCheckData.score_normalised}/100, Rugged: ${rugCheckData.rugged}, Risks: ${rugCheckData.risks.length}`
      );

      return rugCheckData;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          console.log(`ℹ️  Token ${tokenMint} not found in RugCheck database`);
          return null;
        }
        if (error.response?.status === 429) {
          console.warn(`Rate limited by RugCheck API`);
          throw new Error('RugCheck API rate limit exceeded');
        }
        console.error(
          `RugCheck API error for ${tokenMint}:`,
          error.response?.status,
          error.response?.statusText
        );
      } else {
        console.error(`RugCheck service error for ${tokenMint}:`, error);
      }

      return null;
    }
  }

  // Helper method to get risk level summary
  getRiskSummary(risks: RugCheckRisk[]): {
    totalRisks: number;
    highRisks: number;
    mediumRisks: number;
    lowRisks: number;
  } {
    return {
      totalRisks: risks.length,
      highRisks: risks.filter((r) => r.level === 'danger').length,
      mediumRisks: risks.filter((r) => r.level === 'warn').length,
      lowRisks: risks.filter((r) => r.level === 'info').length,
    };
  }

  // Helper method to determine overall risk level
  getOverallRiskLevel(
    score_normalised: number,
    rugged: boolean
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (rugged) return 'critical';
    if (score_normalised <= 20) return 'high';
    if (score_normalised <= 50) return 'medium';
    return 'low';
  }
}

export const rugCheckService = RugCheckService.getInstance();
