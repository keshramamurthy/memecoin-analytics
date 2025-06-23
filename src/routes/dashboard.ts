import { Router } from 'express';

const router = Router();

router.get('/info', (req, res) => {
  res.json({
    name: 'Memecoin Analytics API',
    version: '1.0.0',
    description: 'Real-time Solana memecoin tracking and analytics',
    endpoints: {
      tokens: {
        list: 'GET /api/tokens',
        metrics: 'GET /api/tokens/:mint/metrics',
        holders: 'GET /api/tokens/:mint/holders/top',
        history: 'GET /api/tokens/:mint/history',
      },
      system: {
        health: 'GET /api/health',
        metrics: 'GET /api/metrics',
      },
      websocket: {
        url: '/ws',
        events: ['price_update', 'subscription_success', 'subscription_error'],
      },
    },
    sampleTokens: [
      '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
      'So11111111111111111111111111111111111111112',
    ],
  });
});

export default router;
