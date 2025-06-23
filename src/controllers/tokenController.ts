import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { priceTrackingService } from '../services/priceTrackingService.js';
import { metricService } from '../services/metricService.js';
import { 
  PaginationSchema, 
  MetricsQuerySchema
} from '../types/api.js';

export async function getTokens(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit } = PaginationSchema.parse(req.query);
    const skip = (page - 1) * limit;

    const tokens = await prisma.tokenPrice.findMany({
      orderBy: { lastUpdated: 'desc' },
      skip,
      take: limit,
    });

    const total = await prisma.tokenPrice.count();

    res.json({
      data: tokens.map((token: any) => ({
        mint: token.tokenMint,
        priceUsd: parseFloat(token.priceUsd.toString()),
        priceInSol: parseFloat(token.priceInSol.toString()),
        marketCap: parseFloat(token.marketCap.toString()),
        totalSupply: parseFloat(token.totalSupply.toString()),
        lastUpdated: token.lastUpdated.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid request',
    });
  }
}

export async function getTokenMetrics(req: Request, res: Response): Promise<void> {
  try {
    const { mint } = req.params;
    if (!mint) {
      res.status(400).json({ error: 'Token mint is required' });
      return;
    }
    
    const { window } = MetricsQuerySchema.parse(req.query);

    console.log(`Getting comprehensive metrics for token: ${mint}`);

    // Check if token is already tracked and auto-discover if needed
    let tokenData = await priceTrackingService.getCurrentPrice(mint);
    
    if (!tokenData) {
      // Auto-discover and track new token
      console.log(`Auto-discovering new token: ${mint}`);
      tokenData = await priceTrackingService.getTokenPrice(mint);
      
      // Update the database with new token
      await priceTrackingService.updateTokenPrice(mint);
    }

    // Get comprehensive metrics including concentration ratio and velocity
    const comprehensiveMetrics = await metricService.getTokenMetrics(mint, window);

    res.json(comprehensiveMetrics);
  } catch (error) {
    console.error(`Error getting comprehensive metrics for ${req.params.mint}:`, error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid request',
    });
  }
}

export async function getTokenHolders(req: Request, res: Response): Promise<void> {
  try {
    const { mint } = req.params;
    if (!mint) {
      res.status(400).json({ error: 'Token mint is required' });
      return;
    }
    
    const limit = parseInt(req.query.limit as string) || 10;
    if (limit > 100) {
      res.status(400).json({ error: 'Limit cannot exceed 100' });
      return;
    }

    console.log(`Getting top ${limit} holders for token: ${mint}`);

    const topHolders = await metricService.getTopHolders(mint, limit);

    res.json({
      data: topHolders,
      total: topHolders.length,
      limit,
    });
  } catch (error) {
    console.error(`Error getting holders for ${req.params.mint}:`, error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid request',
    });
  }
}

export async function getTokenHistory(req: Request, res: Response): Promise<void> {
  try {
    const { mint } = req.params;
    if (!mint) {
      res.status(400).json({ error: 'Token mint is required' });
      return;
    }
    
    const { window } = MetricsQuerySchema.parse(req.query);
    
    // Calculate time range based on window
    const now = new Date();
    let startTime = new Date();
    
    switch (window) {
      case '1m':
        startTime = new Date(now.getTime() - 60 * 1000);
        break;
      case '5m':
        startTime = new Date(now.getTime() - 5 * 60 * 1000);
        break;
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 60 * 60 * 1000); // Default 1h
    }

    const priceHistory = await prisma.priceHistory.findMany({
      where: {
        tokenMint: mint,
        timestamp: {
          gte: startTime,
        },
      },
      orderBy: { timestamp: 'asc' },
      take: 1000,
    });

    res.json({
      data: priceHistory.map((entry: any) => ({
        priceUsd: parseFloat(entry.priceUsd.toString()),
        priceInSol: parseFloat(entry.priceInSol.toString()),
        marketCap: parseFloat(entry.marketCap.toString()),
        timestamp: entry.timestamp.toISOString(),
      })),
      window,
      total: priceHistory.length,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid request',
    });
  }
}