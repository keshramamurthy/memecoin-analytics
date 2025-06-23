import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 500,
  duration: '30s',
};

const BASE_URL = 'http://localhost:3305';
const TEST_MINT = 'So11111111111111111111111111111111111111112';

export default function () {
  const metricsResponse = http.get(`${BASE_URL}/tokens/${TEST_MINT}/metrics?window=1h`);
  
  check(metricsResponse, {
    'metrics endpoint status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  const healthResponse = http.get(`${BASE_URL}/health`);
  
  check(healthResponse, {
    'health endpoint status is 200': (r) => r.status === 200,
    'health response time < 500ms': (r) => r.timings.duration < 500,
  });
}