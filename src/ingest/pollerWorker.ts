import { Worker, Queue } from 'bullmq';
import { redis } from '../config/redis.js';
import { priceTrackingService } from '../services/priceTrackingService.js';
import { pollingJobsTotal } from '../config/metrics.js';
import { prisma } from '../config/database.js';

const PRICE_POLL_INTERVAL = 1000; // 1 second

const priceQueue = new Queue('price-tracking', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 1, // No retries by default
  },
});

interface PriceJobData {
  tokenMint: string;
}

const worker = new Worker(
  'price-tracking',
  async (job) => {
    const { tokenMint } = job.data as PriceJobData;
    
    // Check if token is marked as invalid BEFORE processing
    const invalidKey = `invalid_token:${tokenMint}`;
    const isInvalid = await redis.get(invalidKey);
    if (isInvalid) {
      console.log(`Skipping job for invalid token: ${tokenMint}`);
      // Remove this specific job and any repeatable job
      await removeTokenFromTracking(tokenMint);
      return; // Don't throw error - just skip
    }
    
    try {
      await updateTokenPrice(tokenMint);
      pollingJobsTotal.inc({ token_mint: tokenMint, status: 'success' });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid token mint')) {
        console.error(`Invalid token detected: ${tokenMint} - removing from tracking`);
        await removeTokenFromTracking(tokenMint);
        pollingJobsTotal.inc({ token_mint: tokenMint, status: 'invalid' });
        return; // Don't throw error to prevent retries
      } else {
        console.error(`Price update failed for token ${tokenMint}:`, error);
        pollingJobsTotal.inc({ token_mint: tokenMint, status: 'error' });
        throw error; // Throw for genuine errors
      }
    }
  },
  {
    connection: redis,
    concurrency: 10,
  }
);

async function updateTokenPrice(tokenMint: string): Promise<void> {
  console.log(`Updating price for token: ${tokenMint}`);
  
  // Update the token price using PriceTrackingService (includes validation)
  await priceTrackingService.updateTokenPrice(tokenMint);
  
  console.log(`Price updated successfully for token: ${tokenMint}`);
}

async function schedulePriceTrackingJobs(): Promise<void> {
  const allTrackedTokens = await priceTrackingService.getTrackedTokens();
  console.log(`Found ${allTrackedTokens.length} tokens in database`);

  // Filter out invalid tokens before scheduling
  const validTokens: string[] = [];
  
  for (const tokenMint of allTrackedTokens) {
    // Check if token is marked as invalid
    const invalidKey = `invalid_token:${tokenMint}`;
    const isInvalid = await redis.get(invalidKey);
    
    if (isInvalid) {
      console.log(`Skipping invalid token during scheduling: ${tokenMint}`);
      continue;
    }
    
    validTokens.push(tokenMint);
  }
  
  console.log(`Scheduling price tracking for ${validTokens.length} valid tokens (filtered out ${allTrackedTokens.length - validTokens.length} invalid)`);

  for (const tokenMint of validTokens) {
    await addTokenForTracking(tokenMint);
  }
}

worker.on('completed', (job) => {
  console.log(`Price update job ${job.id} completed for token ${job.data.tokenMint}`);
});

worker.on('failed', (job, err) => {
  console.error(`Price update job ${job?.id} failed for token ${job?.data.tokenMint}:`, err);
});

async function cleanupInvalidTokensFromDatabase(): Promise<void> {
  console.log('🧹 Cleaning up invalid tokens from database...');
  
  try {
    const allTokens = await priceTrackingService.getTrackedTokens();
    let cleanedCount = 0;
    
    for (const tokenMint of allTokens) {
      const invalidKey = `invalid_token:${tokenMint}`;
      const isInvalid = await redis.get(invalidKey);
      
      if (isInvalid) {
        console.log(`Removing invalid token from database: ${tokenMint}`);
        await prisma.priceHistory.deleteMany({ where: { tokenMint } });
        await prisma.tokenPrice.deleteMany({ where: { tokenMint } });
        cleanedCount++;
      }
    }
    
    console.log(`✅ Database cleanup complete: removed ${cleanedCount} invalid tokens`);
  } catch (error) {
    console.error('Failed to cleanup invalid tokens from database:', error);
  }
}

async function startWorker(): Promise<void> {
  console.log('Starting price tracking worker...');
  
  // Clean up invalid tokens from database first
  await cleanupInvalidTokensFromDatabase();
  
  // Schedule jobs for valid tokens only
  await schedulePriceTrackingJobs();
  
  console.log('Price tracking jobs scheduled');
  
  // Schedule periodic cleanup every 10 minutes
  setInterval(cleanupInvalidTokensFromDatabase, 10 * 60 * 1000);
}

// Function to add a new token for price tracking
async function addTokenForTracking(tokenMint: string): Promise<void> {
  // ALWAYS validate token FIRST - never trust the caller
  try {
    const { tokenValidationService } = await import('../services/tokenValidationService.js');
    const validation = await tokenValidationService.validateTokenMint(tokenMint);
    
    if (!validation.isValid) {
      console.log(`🚫 REFUSED to track invalid token: ${tokenMint} - ${validation.reason}`);
      // Mark as invalid permanently
      const invalidKey = `invalid_token:${tokenMint}`;
      await redis.setex(invalidKey, 86400, 'true'); // 24 hour ban
      return;
    }
  } catch (validationError) {
    console.log(`🚫 REFUSED to track token due to validation error: ${tokenMint}`);
    return;
  }
  
  // Double-check Redis ban list
  const invalidKey = `invalid_token:${tokenMint}`;
  const isInvalid = await redis.get(invalidKey);
  if (isInvalid) {
    console.log(`🚫 REFUSED to track banned token: ${tokenMint}`);
    return;
  }
  
  const jobId = `price-${tokenMint}`;
  
  // Nuclear option: Remove ALL traces before adding
  await obliterateTokenJobs(tokenMint);
  
  // Add new price tracking job
  await priceQueue.add(
    jobId,
    { tokenMint },
    {
      repeat: { every: PRICE_POLL_INTERVAL },
      jobId,
      attempts: 1,
    }
  );
  
  console.log(`✅ Added VALIDATED token ${tokenMint} for price tracking`);
}

// Nuclear option: Completely obliterate all traces of a token's jobs
async function obliterateTokenJobs(tokenMint: string): Promise<void> {
  const jobId = `price-${tokenMint}`;
  
  try {
    console.log(`☢️ OBLITERATING all traces of token: ${tokenMint}`);
    
    // 1. Get ALL repeatable jobs and remove any that match
    const repeatableJobs = await priceQueue.getRepeatableJobs();
    for (const repeatableJob of repeatableJobs) {
      if (repeatableJob.name === jobId || repeatableJob.id === jobId) {
        try {
          // Create proper RepeatOptions from RepeatableJob
          const every = typeof repeatableJob.pattern === 'number' 
            ? repeatableJob.pattern 
            : PRICE_POLL_INTERVAL;
          const repeatOptions = {
            every,
            ...(repeatableJob.tz && { tz: repeatableJob.tz }),
            ...(repeatableJob.endDate && { endDate: new Date(repeatableJob.endDate) }),
          };
          await priceQueue.removeRepeatable(repeatableJob.name, repeatOptions);
          console.log(`🗑️ Obliterated repeatable job: ${repeatableJob.name}`);
        } catch (e) {
          // Try with different pattern
          try {
            await priceQueue.removeRepeatable(jobId, { every: PRICE_POLL_INTERVAL });
            console.log(`🗑️ Obliterated repeatable job with standard pattern`);
          } catch (e2) {
            console.log(`⚠️ Could not remove repeatable job, continuing...`);
          }
        }
      }
    }
    
    // 2. Remove ALL job instances from ALL states
    const allStates = ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused'];
    let removedCount = 0;
    
    for (const state of allStates) {
      try {
        const jobs = await priceQueue.getJobs([state as any], 0, 1000);
        for (const job of jobs) {
          if (job && job.data && job.data.tokenMint === tokenMint) {
            await job.remove();
            removedCount++;
            console.log(`🗑️ Obliterated ${state} job: ${job.id}`);
          }
        }
      } catch (stateError) {
        // Continue even if some states fail
      }
    }
    
    // 3. Directly remove from Redis using BullMQ's internal keys
    const keys = await redis.keys(`bull:price-tracking:*${jobId}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🗑️ Obliterated ${keys.length} Redis keys for ${tokenMint}`);
    }
    
    console.log(`☢️ OBLITERATION COMPLETE: ${tokenMint} (removed ${removedCount} jobs)`);
  } catch (error) {
    console.error(`Failed to obliterate token ${tokenMint}:`, error);
  }
}

// Function to remove a token from price tracking
async function removeTokenFromTracking(tokenMint: string): Promise<void> {
  try {
    console.log(`🚫 PERMANENTLY BANNING token: ${tokenMint}`);
    
    // Mark as invalid FIRST (so no new jobs get created)
    const invalidKey = `invalid_token:${tokenMint}`;
    await redis.setex(invalidKey, 86400, 'true'); // 24 hour ban
    
    // Obliterate all traces
    await obliterateTokenJobs(tokenMint);
    
    // Clean from database
    await prisma.priceHistory.deleteMany({ where: { tokenMint } });
    await prisma.tokenPrice.deleteMany({ where: { tokenMint } });
    
    console.log(`🚫 PERMANENT BAN COMPLETE: ${tokenMint} - will not be processed again`);
  } catch (error) {
    console.error(`Failed to ban token ${tokenMint}:`, error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch(console.error);
}

export { startWorker, addTokenForTracking, removeTokenFromTracking };