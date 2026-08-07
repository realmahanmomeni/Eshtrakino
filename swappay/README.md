# ماژول Swap Wallet (سواپ والت) — راهنمای یکپارچه‌سازی

ماژول جداشده برای شارژ کیف پول از طریق **Swap Wallet** در پروژه‌های تازهٔ **aiogram V3 + SQLAlchemy (async)**.

منطق از پروژه مبدأ استخراج و از وابستگی‌های اختصاصی (پنل، treasury، UniquePay، …) جدا شده است.

---

## فایل‌ها

| فایل | نقش |
|------|-----|
| `config_example.py` | تنظیمات محیطی (`SWAPPAY_*`) |
| `swap_models.py` | مدل `SwapWalletInvoice` + ایندکس یکتای اسلات PENDING |
| `swap_api.py` | کلاینت API، ساخت فاکتور، matching، polling |
| `swap_handlers.py` | روتر aiogram، کیبوردها، callbackها |

---

## پیش‌نیاز

- Python 3.11+
- `aiogram` ≥ 3
- `sqlalchemy[asyncio]` + درایور PostgreSQL (مثلاً `asyncpg`)
- `httpx`
- `pydantic-settings` (برای نمونهٔ config)

کلید API را از اپلیکیشن [سواپ‌ولت](https://t.me/SwapWalletBot) بسازید.

---

## ۱) متغیرهای محیطی

در `.env` پروژه مقصد:

```env
SWAPPAY_API_KEY=apikey-xxxxxxxx
SWAPPAY_WALLET_ADDRESS=0xYourUsdtAddress
SWAPPAY_WALLET_NETWORK=BSC
SWAPPAY_POLL_INTERVAL_SEC=90
```

---

## ۲) کپی فایل‌ها

پوشه را در پکیج پروژه بگذارید، مثلاً:

```text
your_bot/
  payments/
    config_example.py   # یا ادغام در settings اصلی
    swap_models.py
    swap_api.py
    swap_handlers.py
```

اگر پکیج دارید، importها را از `swap_api` / `swap_models` به مسیر نسبی خودتان عوض کنید (مثلاً `from your_bot.payments.swap_api import ...`).

---

## ۳) مدل و دیتابیس

1. جدول `users` باید از قبل وجود داشته باشد (`user_id` → FK).
2. مدل `SwapWalletInvoice` را به metadata / Alembic اضافه کنید.
3. ایندکس جزئی یکتا روی `exact_crypto_amount` برای ردیف‌های `PENDING` الزامی است (در انتهای `swap_models.py` SQL خام هم هست).

> این ایندکس جلوی دو فاکتور باز با یک مبلغ دقیق را می‌گیرد — اساس matching واریز است.

---

## ۴) اتصال شارژ موجودی (`on_credit`)

ماژول موجودی شما را مستقیم دست نمی‌زند. یک callback بدهید:

```python
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from payments.swap_models import SwapWalletInvoice

async def on_credit(
    db: AsyncSession,
    user_id: int,
    amount: Decimal,
    invoice: SwapWalletInvoice,
) -> Decimal:
    user = await db.get(User, user_id, with_for_update=True)
    user.balance = Decimal(str(user.balance or 0)) + amount
    db.add(user)
    await db.flush()
    return Decimal(str(user.balance))
```

---

## ۵) ثبت روتر و تنظیمات

```python
from aiogram import Dispatcher
from payments.config_example import SwapWalletSettings
from payments.swap_handlers import configure_swap_handlers, swap_router
from payments.swap_api import polling_loop

settings = SwapWalletSettings()

configure_swap_handlers(settings=settings, on_credit=on_credit)

dp = Dispatcher()
dp.include_router(swap_router)

# middleware شما باید db و db_user را تزریق کند
```

نقطه ورود UI: دکمه با `callback_data="swap_deposit"`.

---

## ۶) حلقه polling (پیشنهادی)

در lifespan / startup یک task بسازید:

```python
import asyncio
from payments.swap_api import polling_loop

asyncio.create_task(
    polling_loop(
        session_factory=AsyncSessionLocal,
        settings=settings,
        on_credit=on_credit,
        interval_sec=settings.swappay_poll_interval_sec,
    )
)
```

هر ~۹۰ ثانیه `GET /v2/transaction` زده می‌شود و واریزهای `SUCCEED` با `exact_crypto_amount` match می‌شوند.

---

## جریان پرداخت (خلاصه)

1. کاربر مبلغ USD انتخاب می‌کند.
2. سیستم اسلات کسری یکتا می‌سازد (مثلاً `5.00` → `5.03`).
3. لینک `express-withdraw` (با login هوشمند) نمایش داده می‌شود؛ تبدیل ریالی داخل Mini-App SwapWallet است.
4. تایید خودکار با polling یا دکمه «بررسی وضعیت» — فقط از API سرور، نه ادعای کلاینت.
5. پس از match، `on_credit` موجودی را شارژ می‌کند.

مهلت فاکتور: **۵ ساعت** (سپس `EXPIRED` و آزاد شدن اسلات).  
پنجره matching خودکار: **۲ ساعت** اول.  
Cooldown استعلام دستی: **۶۰ ثانیه**.

---

## نکات امنیتی

- هرگز بدون `provider_confirmed=True` و `provider_ref` شارژ نکنید.
- `provider_ref` برای جلوگیری از double-credit یکتا نگه داشته می‌شود.
- کلید API را فقط سمت سرور نگه دارید؛ در کلاینت/ربات عمومی لو ندهید.

---

## وابستگی‌های حذف‌شده نسبت به پروژه مبدأ

- UniquePay / Plisio / NOWPayments
- گزارش treasury و آلارم موجودی پایین
- مدل مشترک `payment_transactions` با چند درگاه — اینجا جدول اختصاصی `swap_wallet_invoices` است
