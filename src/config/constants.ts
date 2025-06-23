export const SOL_PRICE_FALLBACK = 132.5;
export const SOL_TOTAL_SUPPLY = 589000000;
export const DEFAULT_TOKEN_SUPPLY_FALLBACK = 1000000000;
export const DEFAULT_TOKEN_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1000000000;

export const DEX_PRIORITIES = {
  raydium: 100,
  orca: 90,
  jupiter: 80,
  meteora: 70,
  phoenix: 60,
  openbook: 50,
  serum: 40,
  default: 10,
} as const;

export const CACHE_TTL = {
  PRICE_UPDATE: 3,
  TOKEN_INFO: 300,
  HOLDER_DATA: 60,
} as const;
