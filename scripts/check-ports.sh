#!/usr/bin/env bash
# Check host ports before changing docker-compose / .env bindings.
set -euo pipefail

echo "== Listening TCP ports =="
if command -v ss >/dev/null 2>&1; then
  ss -tuln
elif command -v netstat >/dev/null 2>&1; then
  netstat -tuln
else
  echo "Neither ss nor netstat found" >&2
  exit 1
fi

echo
echo "Eshtrakino reserved ports (must be FREE before start):"
for p in 5433 3100; do
  if ss -tuln 2>/dev/null | grep -qE ":${p}\\b" || netstat -tuln 2>/dev/null | grep -qE ":${p}\\b"; then
    echo "  CONFLICT: ${p} is in use"
  else
    echo "  OK: ${p} is free"
  fi
done
