# Eshtrakino Database Overview

## Engine

PostgreSQL 16 (Docker Compose service `postgres`), published on host port **5433**.

## Models

See `backend/prisma/schema.prisma` (source of truth) and the mirrored notes below.

### User
- `telegramId` (unique BigInt)
- `balance` (Decimal)
- `joinedAt`

### Category
- `name`
- `isActive`

### Product
- `name`, `price`, `categoryId`
- `fulfillmentType`: `PRE_STOCKED` | `MANUAL` | `GROUP_BUY`

### Invoice
- `userId`, `productId`, `amount`, `expiresAt`
- `status`: `PENDING` | `PAID` | `CANCELLED` | `EXPIRED`
- Constraint (application-level): at most one `PENDING` invoice per user
