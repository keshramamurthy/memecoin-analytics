import { z } from 'zod';
import 'dotenv/config';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3305),
  DATABASE_URL: z.string().default('file:./prisma/dev.db'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  HELIUS_API_KEY: z.string(),
  POLL_MS: z.coerce.number().default(2000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

export const env = EnvSchema.parse(process.env);