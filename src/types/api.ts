import { z } from 'zod';

export const WindowSchema = z.enum(['1m', '5m', '1h']);
export type Window = z.infer<typeof WindowSchema>;

export const PaginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const MetricsQuerySchema = z.object({
  window: WindowSchema.default('1h'),
});
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

export const HoldersQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(10),
});
export type HoldersQuery = z.infer<typeof HoldersQuerySchema>;

export const TradesQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(100),
  before: z.coerce.number().optional(),
});
export type TradesQuery = z.infer<typeof TradesQuerySchema>;