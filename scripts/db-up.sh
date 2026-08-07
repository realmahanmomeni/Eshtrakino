#!/usr/bin/env bash
# Start Dockerized PostgreSQL and apply Prisma migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/check-ports.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Engine + Compose plugin first." >&2
  exit 1
fi

echo "Starting PostgreSQL (host port 5433)…"
docker compose up -d postgres

echo "Waiting for health…"
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-eshtrakino}" -d "${POSTGRES_DB:-eshtrakino}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

cd "$ROOT/backend"
if [[ ! -d node_modules ]]; then
  npm install
fi

npx prisma migrate deploy
npx prisma generate

echo "Database ready. Optional seed: npm run db:seed"
