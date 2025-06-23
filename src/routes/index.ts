import { Router } from 'express';
import { healthCheck } from '../controllers/healthController.js';
import { getPrometheusMetrics } from '../controllers/metricsController.js';
import {
  getTokens,
  getTokenMetrics,
  getTokenHolders,
  getTokenHistory,
} from '../controllers/tokenController.js';
import dashboardRouter from './dashboard.js';

const router = Router();

router.get('/health', healthCheck);
router.get('/metrics', getPrometheusMetrics);

router.get('/tokens', getTokens);
router.get('/tokens/:mint/metrics', getTokenMetrics);
router.get('/tokens/:mint/holders/top', getTokenHolders);
router.get('/tokens/:mint/history', getTokenHistory);

router.use('/dashboard', dashboardRouter);

export default router;