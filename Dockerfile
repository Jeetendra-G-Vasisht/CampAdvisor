FROM node:20-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Pre-download the embedding model weights at build time so the container
# never has to hit the network for them on startup (keeps search latency low
# from the very first request instead of a cold-download stall).
RUN node -e "require('./search/embeddings').embedText('warm up').then(() => process.exit(0)).catch(() => process.exit(0))"

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "app.js"]
