# Eshtrakino bot — multi-stage production image
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# --- runtime ---
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV BOT_HEALTH_PORT=3100

RUN apk add --no-cache wget postgresql-client

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install production deps + prisma CLI (needed for migrate deploy)
RUN npm ci --omit=dev \
  && npm install prisma@6.19.3 --no-save \
  && npx prisma generate

COPY --from=builder /app/dist ./dist
COPY prisma/seed.mjs ./prisma/seed.mjs
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/ >/dev/null || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
