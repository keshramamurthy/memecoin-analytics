import { Connection, PublicKey } from '@solana/web3.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';

export interface TokenValidationResult {
  isValid: boolean;
  reason?: string;
  decimals?: number;
  supply?: number;
  name?: string;
  symbol?: string;
}

export class TokenValidationService {
  private static instance: TokenValidationService;
  private connection: Connection;
  private readonly VALIDATION_CACHE_TTL = 3600; // 1 hour cache for validation results

  private constructor() {
    const heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
    this.connection = new Connection(heliusRpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
      httpHeaders: { 'User-Agent': 'memecoin-analytics/1.0' },
    });
  }

  static getInstance(): TokenValidationService {
    if (!TokenValidationService.instance) {
      TokenValidationService.instance = new TokenValidationService();
    }
    return TokenValidationService.instance;
  }

  async validateTokenMint(tokenMint: string): Promise<TokenValidationResult> {
    try {
      // Special case for native SOL
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      if (tokenMint === SOL_MINT) {
        return {
          isValid: true,
          decimals: 9,
          supply: 589000000, // Approximate SOL total supply
          name: 'Solana',
          symbol: 'SOL',
        };
      }

      // Basic format validation
      const formatValidation = this.validateAddressFormat(tokenMint);
      if (!formatValidation.isValid) {
        return formatValidation;
      }

      // Check cache first
      const cacheKey = `token_validation:${tokenMint}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached);
        console.log(
          `📋 Cached validation result for ${tokenMint}: ${result.isValid ? 'VALID' : 'INVALID'}`
        );
        return result;
      }

      // Perform on-chain validation
      const onChainValidation = await this.validateOnChain(tokenMint);

      // Cache the result
      await redis.setex(
        cacheKey,
        this.VALIDATION_CACHE_TTL,
        JSON.stringify(onChainValidation)
      );

      console.log(
        `🔍 Token validation for ${tokenMint}: ${onChainValidation.isValid ? 'VALID' : 'INVALID'} - ${onChainValidation.reason || 'Success'}`
      );

      return onChainValidation;
    } catch (error) {
      console.warn(`Token validation error for ${tokenMint}:`, error);
      return {
        isValid: false,
        reason: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private validateAddressFormat(tokenMint: string): TokenValidationResult {
    // Check if it's a valid base58 string of correct length
    if (!tokenMint || typeof tokenMint !== 'string') {
      return { isValid: false, reason: 'Invalid address format: not a string' };
    }

    // Solana addresses should be 32-44 characters (base58 encoded)
    if (tokenMint.length < 32 || tokenMint.length > 44) {
      return {
        isValid: false,
        reason: 'Invalid address format: incorrect length',
      };
    }

    // Check for valid base58 characters
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    if (!base58Regex.test(tokenMint)) {
      return {
        isValid: false,
        reason: 'Invalid address format: invalid base58 characters',
      };
    }

    // Try to create PublicKey (this validates the format)
    try {
      new PublicKey(tokenMint);
      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        reason: 'Invalid address format: not a valid Solana public key',
      };
    }
  }

  private async validateOnChain(
    tokenMint: string
  ): Promise<TokenValidationResult> {
    try {
      const mintPubkey = new PublicKey(tokenMint);

      // Get token mint account info
      const mintInfo = await this.connection.getAccountInfo(mintPubkey);

      if (!mintInfo) {
        return { isValid: false, reason: 'Token mint account does not exist' };
      }

      // Check if it's a token mint account (should be owned by Token Program)
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
      const TOKEN_2022_PROGRAM_ID =
        'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

      if (
        mintInfo.owner.toString() !== TOKEN_PROGRAM_ID &&
        mintInfo.owner.toString() !== TOKEN_2022_PROGRAM_ID
      ) {
        return { isValid: false, reason: 'Account is not a token mint' };
      }

      // Get token supply and decimals
      try {
        const supplyInfo = await this.connection.getTokenSupply(mintPubkey);

        if (!supplyInfo.value) {
          return { isValid: false, reason: 'Unable to get token supply' };
        }

        const decimals = supplyInfo.value.decimals;
        const supply =
          parseFloat(supplyInfo.value.amount) / Math.pow(10, decimals);

        // Additional validation checks
        if (decimals < 0 || decimals > 18) {
          return { isValid: false, reason: 'Invalid token decimals' };
        }

        if (supply <= 0) {
          return { isValid: false, reason: 'Token has no supply' };
        }

        // Try to get token metadata (optional, for additional info)
        let name: string | undefined;
        let symbol: string | undefined;

        try {
          // This is a basic attempt to get metadata
          // In a production system, you might want to use a metadata program
          const largestAccounts =
            await this.connection.getTokenLargestAccounts(mintPubkey);
          if (largestAccounts.value.length > 0) {
            // Token has holders, which is a good sign
          }
        } catch (metadataError) {
          // Metadata not required for basic validation
        }

        const result: TokenValidationResult = {
          isValid: true,
          decimals,
          supply,
        };

        if (name) result.name = name;
        if (symbol) result.symbol = symbol;

        return result;
      } catch (supplyError) {
        return {
          isValid: false,
          reason: 'Unable to get token supply information',
        };
      }
    } catch (error) {
      return {
        isValid: false,
        reason: `On-chain validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async cleanupInvalidToken(tokenMint: string): Promise<void> {
    try {
      console.log(`🧹 Cleaning up invalid token: ${tokenMint}`);

      // Remove from database
      await prisma.$transaction(async (tx) => {
        // Remove price history
        await tx.priceHistory.deleteMany({
          where: { tokenMint },
        });

        // Remove current price record
        await tx.tokenPrice.deleteMany({
          where: { tokenMint },
        });
      });

      // Remove from Redis cache
      const cacheKeys = [
        `token_price_sol:${tokenMint}`,
        `token_supply:${tokenMint}`,
        `token_decimals:${tokenMint}`,
        `dexscreener_price:${tokenMint}`,
        `pool_address:${tokenMint}:*`,
        `token_validation:${tokenMint}`,
      ];

      for (const key of cacheKeys) {
        if (key.includes('*')) {
          // Handle wildcard keys
          const keys = await redis.keys(key);
          if (keys.length > 0) {
            await redis.del(...keys);
          }
        } else {
          await redis.del(key);
        }
      }

      console.log(`✅ Successfully cleaned up invalid token: ${tokenMint}`);
    } catch (error) {
      console.error(`Failed to cleanup invalid token ${tokenMint}:`, error);
    }
  }

  async validateAndCleanupBatch(
    tokenMints: string[]
  ): Promise<{ valid: string[]; invalid: string[] }> {
    const results = { valid: [] as string[], invalid: [] as string[] };

    console.log(`🔍 Batch validating ${tokenMints.length} tokens...`);

    for (const tokenMint of tokenMints) {
      try {
        const validation = await this.validateTokenMint(tokenMint);

        if (validation.isValid) {
          results.valid.push(tokenMint);
        } else {
          results.invalid.push(tokenMint);
          // Cleanup invalid token
          await this.cleanupInvalidToken(tokenMint);
        }
      } catch (error) {
        console.warn(`Batch validation error for ${tokenMint}:`, error);
        results.invalid.push(tokenMint);
        await this.cleanupInvalidToken(tokenMint);
      }
    }

    console.log(
      `✅ Batch validation complete: ${results.valid.length} valid, ${results.invalid.length} invalid`
    );
    return results;
  }
}

export const tokenValidationService = TokenValidationService.getInstance();
