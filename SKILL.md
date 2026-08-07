---
name: eshtrakino-project
description: >-
  Project rules for Eshtrakino — a scalable Telegram bot for selling digital
  subscriptions. Apply when editing backend bot logic, Prisma schema, invoices,
  payments, or Docker/port config in this repo.
---

# Eshtrakino Project Rules

## Directory Layout (Vibe Coding)

| Path | Purpose |
|------|---------|
| `/backend` | All Node.js / grammY / Prisma code |
| `/frontend` | Reserved for future Next.js app (keep empty until needed) |
| `/resources` | DB schemas, API docs, architecture notes |
| `/examples` | Telegram UI patterns and keyboard examples |
| `/scripts` | Deployment and DB migration bash scripts |
| `/assets` | Static media |

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Bot:** grammY
- **DB:** PostgreSQL (Dockerized) + Prisma ORM
- **Scope:** Digital subscription sales (AI tools, Microsoft licenses, etc.)

## Hard Rules

1. **Dynamic catalog only** — Categories, products, and prices MUST be loaded from PostgreSQL. Never hardcode products or categories in Telegram inline keyboard builders.
2. **Invoice state machine** — A user may have at most ONE `PENDING` invoice. Block new purchases until the pending invoice is paid or cancelled. Support a global Cancel Invoice callback. Expire pending invoices after 5 hours.
3. **Modular payments** — Gateways live under `backend/src/services/payments/` behind a shared interface. Adding fiat/crypto gateways must not change core bot purchase flow.
4. **No VPN/proxy/Marzneshin** — Do not implement VPN, proxy, or Marzneshin panel logic.
5. **Port safety** — Before changing `docker-compose.yml` or `.env` ports, verify host listeners (`ss -tuln`). Current MVP defaults: PostgreSQL host `5433`, bot health HTTP `3100`.

## Assigned Ports (this server)

Checked against existing listeners (SSH 22, DNS 53, Nginx 80/443, MySQL 3306/33060):

| Service | Host Port | Container Port | Notes |
|---------|-----------|----------------|-------|
| PostgreSQL | `5433` | `5432` | Avoids clash with MySQL and default 5432 risk |
| Bot health / webhook | `3100` | n/a (host process) | Avoids 80/443/3000 common conflicts |

## Invoice Statuses

`PENDING` → `AWAITING_RECEIPT` → `AWAITING_APPROVAL` → `PAID`
Also: `CANCELLED` | `EXPIRED`

## Product Delivery Types

`READY` | `MANUAL` | `GROUP`

Products may define `requiredFields` (JSON string array) collected before checkout.

## Admin Panel

- Secure `/admin` and `adm:*` callbacks with `ADMIN_IDS` (comma-separated Telegram IDs) from `.env`.
- Catalog, payment methods, and CRM stats are managed in-bot via grammY conversations.
- Payment methods (`CARD` | `GATEWAY`) are stored in `PaymentMethod` and rendered dynamically at checkout.

## UI Rules

- User category/product keyboards use a strict 2-column grid.
- Every submenu includes a `🔙 بازگشت` back button.
- Never hardcode catalog or payment method lists in keyboard builders.
