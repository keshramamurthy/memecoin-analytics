import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

export const redisSubscriber = new Redis(env.REDIS_URL, {
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

export const redisPublisher = new Redis(env.REDIS_URL, {
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});