# Bot Callback API (internal)

Telegram inline keyboards use short callback payloads:

| Callback | Meaning |
|----------|---------|
| `menu:main` | Main menu |
| `menu:shop` | List categories from DB |
| `menu:account` | Account / balance |
| `cat:{id}` | Products in category `{id}` (DB) |
| `buy:{id}` | Create PENDING invoice for product `{id}` |
| `pay:{id}` | Pay invoice via configured payment gateway |
| `cancel_invoice` | Cancel current PENDING invoice (global) |
| `cancel_inv:{id}` | Cancel specific PENDING invoice |

Catalog data is never hardcoded in handlers — always loaded via `CatalogService`.
