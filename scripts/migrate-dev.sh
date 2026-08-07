#!/usr/bin/env bash
# Create a new Prisma migration (dev) from schema changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:-}"

if [[ -z "$NAME" ]]; then
  echo "Usage: $0 <migration_name>" >&2
  exit 1
fi

cd "$ROOT/backend"
npx prisma migrate dev --name "$NAME"
