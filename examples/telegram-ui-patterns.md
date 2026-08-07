# Telegram UI Patterns

## Dynamic shop flow

1. `/start` → main menu (+ Cancel Invoice if PENDING exists)
2. Shop → categories from `Category` where `isActive`
3. Category → products from `Product` where `isActive` (label includes live `price`)
4. Buy → create PENDING invoice or block if one already exists
5. Pay → `PaymentGateway.createPayment()` (pluggable)
6. Cancel → `cancel_invoice` / `/cancel`

## Rules

- Build keyboards only from DB entities (`builders.ts`).
- Never embed product names or prices as string literals in handlers.
