FROM node:24-slim AS builder

# sharp needs these native libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

# ---

FROM node:24-slim AS production

# sharp needs these native libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000

# Each bot runs as its own process under concurrently, so the probe checks one
# port per bot and skips the ones whose environment leaves them switched off.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "dist/scripts/healthcheck.js", "telegram", "whatsapp", "matrix"]

CMD ["npm", "run", "start:prod"]