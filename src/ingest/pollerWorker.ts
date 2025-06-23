import { Worker, Queue } from 'bullmq';
import { redis, redisPublisher } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { priceTrackingService } from '../services/priceTrackingService.js';
import { pollingJobsTotal } from '../config/metrics.js';

// Using singleton instance imported above
const PRICE_POLL_INTERVAL = 1000; // 1 second

const priceQueue = new Queue('price-tracking', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

interface PriceJobData {
  tokenMint: string;
}

const worker = new Worker(
  'price-tracking',
  async (job) => {
    const { tokenMint } = job.data as PriceJobData;
    
    try {
      await updateTokenPrice(tokenMint);
      pollingJobsTotal.inc({ token_mint: tokenMint, status: 'success' });
    } catch (error) {
      console.error(`Price update failed for token ${tokenMint}:`, error);
      pollingJobsTotal.inc({ token_mint: tokenMint, status: 'error' });
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 10, // Higher concurrency for price updates
  }
);

async function updateTokenPrice(tokenMint: string): Promise<void> {
  console.log(`Updating price for token: ${tokenMint}`);
  
  // Update the token price using PriceTrackingService
  await priceTrackingService.updateTokenPrice(tokenMint);
  
  console.log(`Price updated successfully for token: ${tokenMint}`);
}

// Removed updateHolderSnapshots - no longer tracking individual holders

// Removed recalculateMetrics - metrics are now simply price/market cap from PriceTrackingService

async function schedulePriceTrackingJobs(): Promise<void> {
  const trackedTokens = await priceTrackingService.getTrackedTokens();

  console.log(`Scheduling price tracking for ${trackedTokens.length} tokens`);

  for (const tokenMint of trackedTokens) {
    const jobId = `price-${tokenMint}`;
    
    // Remove existing job if any
    try {
      await priceQueue.removeRepeatable(jobId, {
        every: PRICE_POLL_INTERVAL,
      });
    } catch (error) {
      // Job might not exist, ignore error
    }

    // Add new price tracking job
    await priceQueue.add(
      jobId,
      { tokenMint },
      {
        repeat: { every: PRICE_POLL_INTERVAL }, // 1 second intervals
        jobId,
      }
    );
    
    console.log(`Scheduled price tracking for token: ${tokenMint}`);
  }
}

worker.on('completed', (job) => {
  console.log(`Price update job ${job.id} completed for token ${job.data.tokenMint}`);
});

worker.on('failed', (job, err) => {
  console.error(`Price update job ${job?.id} failed for token ${job?.data.tokenMint}:`, err);
});

async function startWorker(): Promise<void> {
  console.log('Starting price tracking worker...');
  await schedulePriceTrackingJobs();
  console.log('Price tracking jobs scheduled');
}

// Function to add a new token for price tracking
async function addTokenForTracking(tokenMint: string): Promise<void> {
  const jobId = `price-${tokenMint}`;
  
  // Remove existing job if any
  try {
    await priceQueue.removeRepeatable(jobId, {
      every: PRICE_POLL_INTERVAL,
    });
  } catch (error) {
    // Job might not exist, ignore error
  }

  // Add new price tracking job
  await priceQueue.add(
    jobId,
    { tokenMint },
    {
      repeat: { every: PRICE_POLL_INTERVAL },
      jobId,
    }
  );
  
  console.log(`Added token ${tokenMint} for price tracking`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch(console.error);
}

export { startWorker, addTokenForTracking };