import { Request, Response } from 'express';
import { register } from '../config/metrics.js';

export async function getPrometheusMetrics(req: Request, res: Response): Promise<void> {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.send(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate metrics',
    });
  }
}