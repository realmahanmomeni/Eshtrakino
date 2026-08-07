#!/usr/bin/env bash
# Eshtrakino — interactive deploy for Ubuntu/Debian VPS
#
# Usage:
#   chmod +x install.sh && ./install.sh
#
# Run from the repository root (where docker-compose.yml lives).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SWAP_FILE="/swapfile"
SWAP_SIZE="2G"
ENV_FILE=".env"

# ANSI colors
C_RESET="\e[0m"
C_GREEN="\e[32m"
C_CYAN="\e[36m"
C_YELLOW="\e[33m"
C_RED="\e[31m"
C_BOLD="\e[1m"

info()  { echo -e "${C_CYAN}==>${C_RESET} $*"; }
ok()    { echo -e "${C_GREEN}✔${C_RESET} $*"; }
warn()  { echo -e "${C_YELLOW}!${C_RESET} $*"; }
err()   { echo -e "${C_RED}✖${C_RESET} $*" >&2; }

prompt() {
  # usage: prompt "Label" VAR_NAME [default]
  local label="$1"
  local var_name="$2"
  local default="${3-}"
  local input=""
  if [[ -n "$default" ]]; then
    read -r -p "$(echo -e "${C_BOLD}${label}${C_RESET} [${default}]: ")" input
    if [[ -z "$input" ]]; then
      input="$default"
    fi
  else
    while true; do
      read -r -p "$(echo -e "${C_BOLD}${label}${C_RESET}: ")" input
      if [[ -n "$input" ]]; then
        break
      fi
      warn "This value is required."
    done
  fi
  printf -v "$var_name" '%s' "$input"
}

urlencode() {
  local raw="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$raw"
  elif command -v python >/dev/null 2>&1; then
    python -c "import urllib,sys; print(urllib.quote(sys.argv[1], safe=''))" "$raw"
  else
    # Minimal fallback for common special characters
    local out="$raw"
    out="${out//'%'/'%25'}"
    out="${out//' '/'%20'}"
    out="${out//'!'/'%21'}"
    out="${out//'#'/'%23'}"
    out="${out//'$'/'%24'}"
    out="${out//'&'/'%26'}"
    out="${out//'+'/'%2B'}"
    out="${out//'/'/'%2F'}"
    out="${out//':'/'%3A'}"
    out="${out//'='/'%3D'}"
    out="${out//'?'/'%3F'}"
    out="${out//'@'/'%40'}"
    printf '%s' "$out"
  fi
}

echo
echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════╗${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}║     Welcome to Eshtrakino Setup          ║${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════╝${C_RESET}"
echo
info "Working directory: $ROOT_DIR"
echo

# ---------------------------------------------------------------------------
# 1) 2GB swap — prevents OOM during docker compose build on low-RAM VPS
# ---------------------------------------------------------------------------
ensure_swap() {
  if swapon --show 2>/dev/null | grep -q .; then
    info "Swap already active:"
    swapon --show
    return 0
  fi

  if [[ -f "$SWAP_FILE" ]]; then
    info "Found existing $SWAP_FILE — enabling…"
  else
    info "Creating ${SWAP_SIZE} swap at $SWAP_FILE (OOM prevention)…"
    if command -v fallocate >/dev/null 2>&1; then
      fallocate -l "$SWAP_SIZE" "$SWAP_FILE"
    else
      dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 status=progress
    fi
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE"
  fi

  swapon "$SWAP_FILE" || true

  if ! grep -qE "^${SWAP_FILE}\s" /etc/fstab 2>/dev/null; then
    info "Persisting swap in /etc/fstab…"
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  fi

  ok "Swap ready"
  swapon --show || true
  free -h || true
}

info "Preparing swap space…"
if [[ "$(id -u)" -eq 0 ]]; then
  ensure_swap
else
  if command -v sudo >/dev/null 2>&1; then
    sudo bash -c "$(declare -f ensure_swap); SWAP_FILE='$SWAP_FILE'; SWAP_SIZE='$SWAP_SIZE'; ensure_swap"
  else
    warn "No root/sudo — skip swap setup. Builds on small VPS may OOM."
  fi
fi
echo

# ---------------------------------------------------------------------------
# 2) Docker + Compose plugin
# ---------------------------------------------------------------------------
info "Checking Docker…"
if ! command -v docker >/dev/null 2>&1; then
  info "Docker not found — installing via get.docker.com…"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  if [[ "$(id -u)" -eq 0 ]]; then
    sh /tmp/get-docker.sh
  else
    sudo sh /tmp/get-docker.sh
  fi
  rm -f /tmp/get-docker.sh

  if [[ "$(id -u)" -ne 0 ]] && command -v sudo >/dev/null 2>&1; then
    sudo usermod -aG docker "$USER" || true
    warn "You may need to log out/in (or run: newgrp docker) for the docker group to apply."
  fi
  ok "Docker installed"
else
  ok "Docker already installed: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
  err "'docker compose' plugin is missing. Install Docker Compose v2, then re-run."
  exit 1
fi
ok "Compose: $(docker compose version)"
echo

# ---------------------------------------------------------------------------
# 3) Interactive .env generation
# ---------------------------------------------------------------------------
if [[ ! -t 0 ]]; then
  err "This installer needs an interactive terminal (TTY) to collect secrets."
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  warn "Existing $ENV_FILE found."
  read -r -p "$(echo -e "${C_BOLD}Overwrite it? [y/N]${C_RESET}: ")" overwrite
  overwrite="${overwrite:-N}"
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    info "Keeping existing $ENV_FILE"
    SKIP_ENV=1
  else
    SKIP_ENV=0
  fi
else
  SKIP_ENV=0
fi

if [[ "${SKIP_ENV:-0}" -eq 0 ]]; then
  echo
  echo -e "${C_GREEN}${C_BOLD}Generating .env file…${C_RESET}"
  echo -e "Leave blank to accept the ${C_CYAN}[default]${C_RESET} where shown."
  echo

  prompt "Telegram BOT_TOKEN (from @BotFather)" BOT_TOKEN
  prompt "Admin Telegram IDs (comma-separated)" ADMIN_IDS

  echo
  info "PostgreSQL settings"
  prompt "POSTGRES_USER" POSTGRES_USER "eshtrakino"
  prompt "POSTGRES_PASSWORD (choose a strong password)" POSTGRES_PASSWORD
  prompt "POSTGRES_DB" POSTGRES_DB "eshtrakino"
  prompt "POSTGRES_HOST_PORT (host → container 5432)" POSTGRES_HOST_PORT "5433"
  prompt "BOT_HEALTH_PORT" BOT_HEALTH_PORT "3100"

  echo
  info "Bot / payments (optional overrides)"
  prompt "INVOICE_TTL_HOURS" INVOICE_TTL_HOURS "5"
  prompt "PAYMENT_GATEWAY (balance|stub)" PAYMENT_GATEWAY "balance"
  prompt "SWAPPAY_WALLET_ADDRESS (optional fallback; can set later in admin)" SWAPPAY_WALLET_ADDRESS ""
  prompt "SWAPPAY_WALLET_NETWORK" SWAPPAY_WALLET_NETWORK "BSC"
  prompt "SWAPPAY_POLL_INTERVAL_SEC" SWAPPAY_POLL_INTERVAL_SEC "90"

  POSTGRES_PASSWORD_URLENC="$(urlencode "$POSTGRES_PASSWORD")"
  DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD_URLENC}@127.0.0.1:${POSTGRES_HOST_PORT}/${POSTGRES_DB}?schema=public&connection_limit=5"

  info "Writing $ENV_FILE…"
  cat > "$ENV_FILE" <<EOF
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# PostgreSQL host port → container 5432 | Bot health → ${BOT_HEALTH_PORT}

POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_PASSWORD_URLENC=${POSTGRES_PASSWORD_URLENC}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_HOST_PORT=${POSTGRES_HOST_PORT}
BOT_HEALTH_PORT=${BOT_HEALTH_PORT}

# Host-side Prisma tooling (bot container overrides host to postgres:5432)
DATABASE_URL=${DATABASE_URL}

BOT_TOKEN=${BOT_TOKEN}

INVOICE_TTL_HOURS=${INVOICE_TTL_HOURS}

PAYMENT_GATEWAY=${PAYMENT_GATEWAY}

# Swap Wallet (API key preferred via admin → SystemSetting; env is fallback)
SWAPPAY_WALLET_ADDRESS=${SWAPPAY_WALLET_ADDRESS}
SWAPPAY_WALLET_NETWORK=${SWAPPAY_WALLET_NETWORK}
SWAPPAY_POLL_INTERVAL_SEC=${SWAPPAY_POLL_INTERVAL_SEC}

# Comma-separated Telegram numeric IDs
ADMIN_IDS=${ADMIN_IDS}
EOF

  chmod 600 "$ENV_FILE" || true
  ok ".env written (mode 600)"
else
  ok "Using existing .env"
fi

echo

# ---------------------------------------------------------------------------
# 4) Build & start
# ---------------------------------------------------------------------------
echo -e "${C_GREEN}${C_BOLD}Starting Docker…${C_RESET}"
info "Running: docker compose up -d --build"
docker compose up -d --build

echo
echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════╗${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}║          Eshtrakino is starting          ║${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════╝${C_RESET}"
echo
ok "Status:  docker compose ps"
ok "Logs:    docker compose logs -f bot"
HEALTH_PORT="$(grep -E '^BOT_HEALTH_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
HEALTH_PORT="${HEALTH_PORT:-3100}"
ok "Health:  curl -s http://127.0.0.1:${HEALTH_PORT}/"
echo
info "Open Telegram → message your bot → /admin with an ID from ADMIN_IDS."
info "Configure Swap API key & wallet under: Admin → Payments → List & Settings"
echo
