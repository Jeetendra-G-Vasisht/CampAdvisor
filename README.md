# CampAdvisor

A full-stack campground discovery platform: browse, review, and post campgrounds, plus **AI-powered semantic search** — describe the kind of trip you want ("quiet lakeside spot with a fire pit") and get ranked results, not just keyword matches.

## Architecture

```
Browser ──▶ Express (EJS views, sessions, auth)
              │
              ├──▶ MongoDB          campground/review/user documents
              │                     + a persisted embedding vector per campground
              │
              ├──▶ search/ module   embeds text locally (@xenova/transformers,
              │                     Xenova/all-mpnet-base-v2) and ranks by
              │                     cosine similarity
              │
              └──▶ Redis            caches campground vectors and recent query
                                    vectors so a repeat/similar search skips
                                    model inference and a Mongo round trip
```

### Why a larger embedding model

The initial search prototype used a small MiniLM-class embedding model. It
consistently mis-ranked domain-specific terms ("yurt", "ADA-accessible",
"RV hookup", "primitive backcountry site") because a small model's vector
space doesn't separate that vocabulary well. Switching to
`Xenova/all-mpnet-base-v2` (768-dim vs 384-dim) meaningfully improved
relevance at the cost of a heavier model — which is exactly what the Redis
caching layer below is there to offset.

### Why Redis

Two things are cached in Redis, both to keep search latency low:

- **Campground vectors** (`vec:campground:<id>`) — computed once when a
  campground is created/updated, so a search never has to re-embed campground
  text or hit Mongo for it on the hot path (Mongo stores it too, as the
  source of truth, and Redis is backfilled from Mongo on a cache miss).
- **Query vectors** (`vec:query:<sha1(query)>`, 1h TTL) — identical or
  near-identical repeat searches skip model inference entirely, which is the
  single most expensive step in the request.

If Redis is unreachable, `search/vectorCache.js` fails soft: it logs a
warning once and falls back to computing everything on demand, so the app
still works (just slower) without Redis in local dev.

## Local development

```bash
cp .env.example .env       # fill in MAPBOX_TOKEN / CLOUDINARY_* if you want image upload + geocoding
npm install
npm run seed                # seeds 300 campgrounds and computes/caches their embeddings
npm run dev                  # http://localhost:3000
```

Mongo and Redis must be reachable at `DB_URL` / `REDIS_URL` (defaults to
`localhost`). Easiest way to get both without installing anything locally:

```bash
docker compose up -d mongo redis
```

If you already have campgrounds in the database from before this feature
existed, backfill their embeddings instead of reseeding:

```bash
npm run backfill:embeddings
```

## Docker

```bash
docker compose up --build
```

Brings up the app, MongoDB, and Redis together, wired via `DB_URL` /
`REDIS_URL` in `docker-compose.yml`. The `Dockerfile` pre-downloads the
embedding model weights at build time, so the container never stalls on a
model download at startup.

## Deploying to AWS

This repo ships deployment-ready config; it doesn't deploy anything by
itself since it isn't wired to a live AWS account.

1. **ECR** — create a repository (`campadvisor`) to hold built images.
2. **Secrets Manager** — store `DB_URL`, `REDIS_URL`, `SESSION_SECRET`,
   `MAPBOX_TOKEN`, `CLOUDINARY_*` as secrets; `deploy/ecs-task-definition.json`
   references them by ARN.
3. **DocumentDB** (Mongo-compatible) and **ElastiCache for Redis** — managed
   equivalents of the local containers; put their connection strings in the
   secrets above.
4. **ECS Fargate** — create a cluster/service from
   `deploy/ecs-task-definition.json` (swap in your account ID/region),
   fronted by an ALB target group health-checking `GET /healthz`.
5. **CI/CD** — `.github/workflows/deploy.yml` builds the Docker image, pushes
   it to ECR, and forces a new ECS deployment on every push to `main`. It
   needs these repo secrets configured before it can run:
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
   `ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE`.

## Load testing

`loadtest/search-load-test.js` is a [k6](https://k6.io) script that mixes AI
search, campground browsing, and health-check traffic.

```bash
# smoke test: verifies the script itself against a live instance
docker run --rm -i --network host grafana/k6 run -e SMOKE=true -e BASE_URL=http://localhost:3000 - < loadtest/search-load-test.js

# full run: ramps to 10,000 concurrent VUs (needs distributed load
# generation — a single machine can't open that many sockets on its own;
# use k6 cloud or several load-generator hosts pointed at BASE_URL)
k6 run -e BASE_URL=https://your-deployed-host loadtest/search-load-test.js
```

Thresholds (`http_req_failed < 1%`, `p95 latency < 500ms`) are asserted in
the script itself, so a run fails its exit code if the app degrades under
load.

## Tech stack

Express, EJS, MongoDB/Mongoose, Passport (local auth), Cloudinary (image
uploads), Mapbox (geocoding + cluster map), `@xenova/transformers` (local
embedding inference), Redis/`ioredis` (vector cache), Docker, AWS
ECS/Fargate + ECR + DocumentDB + ElastiCache, k6.
