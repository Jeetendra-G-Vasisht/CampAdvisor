const crypto = require('crypto');
const Redis = require('ioredis');

const QUERY_TTL_SECONDS = 60 * 60; // 1 hour

let client = null;
let warnedOnce = false;

function getClient() {
    if (client) return client;
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // don't keep retrying forever if Redis is absent
    });
    client.on('error', () => {
        if (!warnedOnce) {
            console.warn('[vectorCache] Redis unavailable, falling back to uncached embedding lookups');
            warnedOnce = true;
        }
    });
    return client;
}

async function safeCall(fn) {
    try {
        const c = getClient();
        if (c.status === 'wait') await c.connect().catch(() => {});
        return await fn(c);
    } catch (err) {
        return null;
    }
}

function normalizeQuery(query) {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function queryKey(query) {
    const hash = crypto.createHash('sha1').update(normalizeQuery(query)).digest('hex');
    return `vec:query:${hash}`;
}

function campgroundKey(id) {
    return `vec:campground:${id}`;
}

async function getCampgroundVector(id) {
    const raw = await safeCall((c) => c.get(campgroundKey(id)));
    return raw ? JSON.parse(raw) : null;
}

async function setCampgroundVector(id, vector) {
    await safeCall((c) => c.set(campgroundKey(id), JSON.stringify(vector)));
}

async function getCampgroundVectors(ids) {
    if (ids.length === 0) return {};
    const raws = await safeCall((c) => c.mget(ids.map(campgroundKey)));
    const result = {};
    if (!raws) return result;
    ids.forEach((id, i) => {
        if (raws[i]) result[id] = JSON.parse(raws[i]);
    });
    return result;
}

async function getQueryVector(query) {
    const raw = await safeCall((c) => c.get(queryKey(query)));
    return raw ? JSON.parse(raw) : null;
}

async function setQueryVector(query, vector) {
    await safeCall((c) => c.set(queryKey(query), JSON.stringify(vector), 'EX', QUERY_TTL_SECONDS));
}

module.exports = {
    getCampgroundVector,
    setCampgroundVector,
    getCampgroundVectors,
    getQueryVector,
    setQueryVector,
};
