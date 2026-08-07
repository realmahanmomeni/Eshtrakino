# Eshtrakino

Professional Telegram commerce bot for digital subscriptions and inventory sales — built with **Node.js**, **TypeScript**, **GrammY**, and **Prisma** on **PostgreSQL**.

Eshtrakino combines a Fluid UI admin panel, a wallet + multi-gateway checkout flow, and background workers for renewals, invoice expiry, backups, and Swap Wallet deposit matching.

---

## Key Features

- **Multi-gateway payments**
  - Card-to-card (dynamic methods from DB, tap-to-copy card number, receipt upload)
  - Online gateway methods (e.g. ZarinPal token config)
  - **Swap Wallet crypto** — unique fractional USDT slots, express-withdraw links, 90s deposit polling, 30-minute lazy USDT/IRT rate cache
- **Checkout & wallet top-up** — all active `PaymentMethod` rows appear dynamically in both flows; Swap Wallet optional via `SWAPPAY_ENABLED`
- **Strict Fluid UI** — in-place `safeEdit` / panel editing, user-input cleanup, `toPlain()` for conversation-safe Prisma data
- **Dynamic runtime config** — API keys, wallet address, Swap enable flag, log group, backup interval stored in `SystemSetting` (admin-editable)
- **Catalog & inventory** — categories, products, READY/MANUAL/CREDENTIALS delivery, stock alerts, restock
- **Wallet ledger** — balance, top-ups, wallet checkout, fulfillment pipeline
- **Ticketing** — user support tickets with admin reply / group topic mapping
- **Cron workers** — renewal reminders, invoice expiry, auto DB backup, Swap Wallet deposit detector

---

## Tech Stack

| Layer | Technology |
|--------|------------|
| Runtime | Node.js 22 (Alpine), TypeScript |
| Bot | [GrammY](https://grammy.dev/) + `@grammyjs/conversations` |
| ORM / DB | Prisma 6 + PostgreSQL 16 |
| Validation | Zod |
| Deploy | Docker Compose |
| Payments | Card / Gateway (`PaymentMethod`) + Swap Wallet API |

---

## Project Layout

```text
Eshtrakino/
├── docker-compose.yml      # postgres + bot
├── .env.example            # root env template (Compose)
├── install.sh              # one-shot Linux deploy
├── backend/
│   ├── Dockerfile
│   ├── docker-entrypoint.sh  # migrate → seed → start
│   ├── prisma/               # schema + migrations + seed
│   └── src/                  # bot, services, cron
└── swappay/                  # reference Python module (docs only)
```

---

## Environment Variables

Copy from `.env.example` at the **repo root** (Compose uses this file):

| Variable | Description |
|----------|-------------|
| `POSTGRES_USER` | Postgres username |
| `POSTGRES_PASSWORD` | Postgres password (plain) |
| `POSTGRES_PASSWORD_URLENC` | Same password, URL-encoded for Compose `DATABASE_URL` (`@` → `%40`, etc.) |
| `POSTGRES_DB` | Database name |
| `POSTGRES_HOST_PORT` | Host port mapped to Postgres (`5433` by default) |
| `BOT_HEALTH_PORT` | Bot health HTTP port (`3100` by default) |
| `DATABASE_URL` | Host-side Prisma URL (for local tooling). **Inside Docker**, Compose overrides this to `postgres:5432` |
| `BOT_TOKEN` | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `INVOICE_TTL_HOURS` | Pending invoice lifetime (default `5`) |
| `PAYMENT_GATEWAY` | `balance` \| `stub` |
| `SWAPPAY_WALLET_ADDRESS` | Fallback USDT receive address (prefer Admin → SystemSetting) |
| `SWAPPAY_WALLET_NETWORK` | Network for express-withdraw (default `BSC`) |
| `SWAPPAY_POLL_INTERVAL_SEC` | Deposit detector interval (default `90`) |
| `ADMIN_IDS` | Comma-separated Telegram numeric IDs for `/admin` |

**Admin-managed (SystemSetting, not required in `.env`):**

- `SWAPPAY_API_KEY` — Bearer key for Swap Wallet API  
- `SWAPPAY_WALLET_ADDRESS` — preferred over env when set in admin  
- `SWAPPAY_ENABLED` — show/hide crypto in checkout & wallet UI  
- Log group / backup / topic IDs — configured from the admin panel  

---

## Quick Install (Linux VPS)

```bash
chmod +x install.sh
./install.sh
```

The script will:

1. Create a **2GB swap file** if missing (prevents OOM during `docker compose build` on small VPS)
2. Install **Docker** (+ Compose plugin) when needed
3. Create `.env` from `.env.example` if missing and pause for you to edit secrets
4. Run `docker compose up -d --build`

After start, open the bot in Telegram and use `/admin` with an ID listed in `ADMIN_IDS`.

---

## Manual Docker Deploy

```bash
cp .env.example .env
# Edit .env — set BOT_TOKEN, ADMIN_IDS, strong POSTGRES_PASSWORD (+ URL-encoded twin)

docker compose up -d --build
docker compose logs -f bot
```

Useful commands:

```bash
docker compose ps
docker compose restart bot
docker compose exec bot npx prisma migrate deploy
curl -s http://127.0.0.1:3100/   # health JSON
```

On boot the bot container runs:

1. `prisma migrate deploy`
2. Idempotent `seed.mjs`
3. `node dist/index.js`

---

## Local Development (optional)

```bash
cd backend
cp ../.env.example .env   # point DATABASE_URL at local Postgres
npm ci
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

Requires Node.js ≥ 20 and a reachable PostgreSQL instance.

---

## Admin Quick Start

1. Set `ADMIN_IDS` and restart the bot  
2. Send `/admin` in a private chat with the bot  
3. **Payments → List & Settings** — toggle Card / Gateway / Swap; set Swap API key & wallet address  
4. Configure catalog, log group, and auto-backup as needed  

---

## License

Private / proprietary unless otherwise stated by the project owner.
