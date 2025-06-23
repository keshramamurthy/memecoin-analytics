import { beforeAll, afterAll } from 'vitest';
import { prisma } from '../config/database.js';

beforeAll(async () => {
  process.env.DATABASE_URL = 'file:./test.db';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.HELIUS_API_KEY = 'test-key';
});

afterAll(async () => {
  await prisma.$disconnect();
});
