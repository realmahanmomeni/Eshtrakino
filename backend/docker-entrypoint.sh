#!/bin/sh
set -e

echo "[eshtrakino] Running Prisma migrations…"
npx prisma migrate deploy

echo "[eshtrakino] Ensuring demo catalog seed (idempotent)…"
node prisma/seed.mjs

echo "[eshtrakino] Starting bot…"
exec node dist/index.js
