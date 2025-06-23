import { Decimal } from 'decimal.js';

export interface TokenMetrics {
  tokenMint: string;
  marketCap: Decimal;
  tokenVelocity: Decimal;
  concentrationRatio: Decimal;
  paperhandRatio: Decimal;
  updatedAt: Date;
}

export interface TradeData {
  id: number;
  txSig: string;
  slot: bigint;
  blockTime: Date;
  tokenMint: string;
  buyer: string;
  seller: string;
  amount: Decimal;
  priceUsd: Decimal;
}

export interface HolderData {
  holder: string;
  balance: Decimal;
  percentage: number;
}

export interface MetricsCalculationInput {
  trades: TradeData[];
  holderSnapshots: Array<{
    holder: string;
    balance: Decimal;
    capturedAt: Date;
  }>;
  totalSupply: Decimal;
  circulatingSupply: Decimal;
  window: '1m' | '5m' | '1h';
}