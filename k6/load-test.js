import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
export const errorRate = new Rate('errors');

// Test configuration
export const options = {
  // Load test stages
  stages: [
    { duration: '10s', target: 50 },   // Ramp up to 50 VUs
    { duration: '30s', target: 500 },  // Peak load: 500 VUs for 30 seconds
    { duration: '10s', target: 0 },    // Ramp down to 0 VUs
  ],
  
  // Thresholds for performance criteria
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% of requests must complete within 1s
    http_req_failed: ['rate<0.05'],    // Error rate must be below 5%
    errors: ['rate<0.05'],             // Custom error rate below 5%
  },
};

// Test token mint address
const TEST_TOKEN = '71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// Test data for various endpoints
const TEST_SCENARIOS = [
  { name: 'token_metrics', endpoint: `/tokens/${TEST_TOKEN}/metrics?window=1m`, weight: 40 },
  { name: 'token_metrics_5m', endpoint: `/tokens/${TEST_TOKEN}/metrics?window=5m`, weight: 20 },
  { name: 'token_metrics_1h', endpoint: `/tokens/${TEST_TOKEN}/metrics?window=1h`, weight: 15 },
  { name: 'token_history', endpoint: `/tokens/${TEST_TOKEN}/history?window=1m`, weight: 15 },
  { name: 'tokens_list', endpoint: '/tokens?page=1&limit=10', weight: 5 },
  { name: 'health_check', endpoint: '/health', weight: 5 },
];

// Weight-based scenario selection
function selectScenario() {
  const random = Math.random() * 100;
  let cumulativeWeight = 0;
  
  for (const scenario of TEST_SCENARIOS) {
    cumulativeWeight += scenario.weight;
    if (random <= cumulativeWeight) {
      return scenario;
    }
  }
  
  return TEST_SCENARIOS[0]; // Fallback
}

export default function () {
  const scenario = selectScenario();
  
  // Make HTTP request
  const response = http.get(`${BASE_URL}${scenario.endpoint}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'k6-load-test/1.0',
    },
    timeout: '10s',
  });

  // Check response
  const success = check(response, {
    [`${scenario.name}: status is 200`]: (r) => r.status === 200,
    [`${scenario.name}: response time < 1000ms`]: (r) => r.timings.duration < 1000,
    [`${scenario.name}: has valid JSON`]: (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch (e) {
        return false;
      }
    },
  });

  // Track errors
  errorRate.add(!success);

  // Specific checks based on endpoint
  if (scenario.endpoint.includes('/metrics')) {
    check(response, {
      [`${scenario.name}: has price data`]: (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.priceUsd !== undefined && data.marketCap !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
  }

  if (scenario.endpoint.includes('/tokens')) {
    check(response, {
      [`${scenario.name}: has pagination`]: (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.pagination !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
  }

  // Log errors for debugging
  if (response.status !== 200) {
    console.log(`❌ ${scenario.name} failed: ${response.status} - ${response.body.substring(0, 100)}`);
  }

  // Random delay between requests (0.1-0.5 seconds)
  sleep(Math.random() * 0.4 + 0.1);
}

// Setup function - runs once before the test
export function setup() {
  console.log('🚀 Starting load test...');
  console.log(`📍 Target URL: ${BASE_URL}`);
  console.log(`🎯 Test Token: ${TEST_TOKEN}`);
  
  // Warm up the API
  const warmupResponse = http.get(`${BASE_URL}/health`);
  if (warmupResponse.status !== 200) {
    throw new Error(`API warmup failed: ${warmupResponse.status}`);
  }
  
  console.log('✅ API warmup successful');
  return { startTime: new Date().toISOString() };
}

// Teardown function - runs once after the test
export function teardown(data) {
  console.log('🏁 Load test completed');
  console.log(`📊 Test started at: ${data.startTime}`);
  console.log(`📊 Test ended at: ${new Date().toISOString()}`);
}

// Export for use in other scripts
export { TEST_TOKEN, BASE_URL };