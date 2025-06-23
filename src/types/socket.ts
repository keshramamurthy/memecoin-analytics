export interface SocketTradeEvent {
  slot: number;
  txSig: string;
  tokenMint: string;
  buyer: string;
  seller: string;
  amount: string;
  priceUsd: string;
  timestamp: number;
}

export interface SocketMetricsEvent {
  tokenMint: string;
  marketCap: string;
  tokenVelocity: string;
  concentrationRatio: string;
  paperhandRatio: string;
  updatedAt: number;
}