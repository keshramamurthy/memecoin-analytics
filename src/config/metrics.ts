import {
  register,
  collectDefaultMetrics,
  Counter,
  Histogram,
} from 'prom-client';

collectDefaultMetrics();

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.1, 0.5, 1, 2, 5],
});

export const pollingJobsTotal = new Counter({
  name: 'polling_jobs_total',
  help: 'Total number of polling jobs processed',
  labelNames: ['token_mint', 'status'],
});

export const metricsCalculationsTotal = new Counter({
  name: 'metrics_calculations_total',
  help: 'Total number of metrics calculations performed',
  labelNames: ['token_mint'],
});

export { register };
