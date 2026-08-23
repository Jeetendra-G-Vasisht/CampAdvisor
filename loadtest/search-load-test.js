import http from 'k6/http';
import { check, sleep } from 'k6';

// Full run (default): ramps to 10,000 concurrent virtual users against
// BASE_URL and holds there, mixing AI search, browse, and health-check
// traffic. This needs a distributed k6 setup (k6 cloud, or multiple
// load-generator machines/pods) to actually produce 10k concurrent
// connections from a single host.
//
// Smoke test (SMOKE=true k6 run ...): a tiny run used to verify the script
// itself is correct against a live instance before a real large-scale run.
const SMOKE = __ENV.SMOKE === 'true';

export const options = SMOKE
    ? {
        vus: 10,
        duration: '15s',
        thresholds: {
            http_req_failed: ['rate<0.01'],
        },
    }
    : {
        stages: [
            { duration: '2m', target: 2000 },
            { duration: '3m', target: 10000 },
            { duration: '5m', target: 10000 },
            { duration: '2m', target: 0 },
        ],
        thresholds: {
            http_req_failed: ['rate<0.01'],
            http_req_duration: ['p(95)<500'],
        },
    };

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const SEARCH_QUERIES = [
    'quiet lakeside spot with a fire pit',
    'RV hookup with full amenities',
    'secluded forest campsite for tent camping',
    'ADA accessible campground near a river',
    'pet friendly site with hiking trails nearby',
    'mountain view with cool nights',
    'beachfront camping for families',
    'primitive backcountry site',
];

function randomQuery() {
    return SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
}

export default function () {
    const roll = Math.random();

    if (roll < 0.6) {
        const q = encodeURIComponent(randomQuery());
        const res = http.get(`${BASE_URL}/campgrounds/search?q=${q}`);
        check(res, { 'search status is 200': (r) => r.status === 200 });
    } else if (roll < 0.9) {
        const res = http.get(`${BASE_URL}/campgrounds`);
        check(res, { 'browse status is 200': (r) => r.status === 200 });
    } else {
        const res = http.get(`${BASE_URL}/healthz`);
        check(res, { 'health status is 200': (r) => r.status === 200 });
    }

    sleep(Math.random() * 2 + 1);
}
