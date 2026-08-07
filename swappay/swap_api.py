"""کلاینت و منطق کسب‌وکار Swap Wallet — شارژ کیف پول (generic top-up).

جریان کلی:
1. کاربر مبلغ USD انتخاب می‌کند → ``create_invoice`` اسلات کسری یکتا می‌سازد
2. لینک express-withdraw (با login هوشمند) به کاربر داده می‌شود
3. polling یا دکمه «بررسی وضعیت» با ``GET /v2/transaction`` واریز SUCCEED را match می‌کند
4. با تایید، ``on_credit`` فراخوانی می‌شود تا موجودی پروژه مقصد شارژ شود

وابستگی‌های پروژه مبدأ (پنل، treasury، UniquePay، …) حذف شده‌اند.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Awaitable, Callable, Protocol
from urllib.parse import quote, urlencode

import httpx
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from swap_models import (
    GATEWAY_SWAPWALLET,
    SwapInvoiceStatus,
    SwapWalletInvoice,
)

logger = logging.getLogger(__name__)

SWAPWALLET_API_BASE = "https://swapwallet.app/api"

# Mini-App SwapWallet مبلغ را به ۲ رقم اعشار می‌برد — اسلات‌ها باید مطابق باشند.
_AMOUNT_QUANT = Decimal("0.01")
_FRACTION_MIN_UNITS = 1       # 0.01
_FRACTION_TIER1_MAX = 9       # باند ترجیحی UX: 0.01 .. 0.09
_FRACTION_MAX_UNITS = 99      # باند کامل: 0.10 .. 0.99
_SLOT_ADVISORY_NS = 740_501   # namespace برای pg_advisory_xact_lock
_ALLOC_INSERT_RETRIES = 5

INVOICE_LIFETIME_HOURS = 5    # PENDING → EXPIRED بعد از این مدت (آزاد شدن اسلات)
POLL_ACTIVE_HOURS = 2         # پنجره matching خودکار در background

_VERIFY_COOLDOWN_SEC = 60.0
_VERIFY_LAST: dict[int, float] = {}


# ---------------------------------------------------------------------------
# Exceptions / Protocols
# ---------------------------------------------------------------------------

class SwapPayError(Exception):
    """خطای عمومی درگاه Swap Wallet."""


class ExchangePriceError(SwapPayError):
    """عدم دریافت نرخ زنده USDT/IRT."""


class SwappayVerifyRateLimited(SwapPayError):
    """استعلام دستی قبل از پایان cooldown."""


class SwapSettings(Protocol):
    swappay_api_key: str
    swappay_wallet_address: str
    swappay_wallet_network: str


# بعد از تایید پرداخت فراخوانی می‌شود تا موجودی کاربر شارژ شود.
# باید موجودی جدید را برگرداند (برای نمایش به کاربر).
CreditCallback = Callable[
    [AsyncSession, int, Decimal, SwapWalletInvoice],
    Awaitable[Decimal],
]

# اختیاری: اطلاع‌رسانی تلگرام پس از تایید خودکار polling
NotifyCallback = Callable[
    [int, SwapWalletInvoice, Decimal, Decimal],
    Awaitable[None],
]


@dataclass(frozen=True)
class ApproveResult:
    invoice_id: int
    credited: bool
    already_verified: bool
    amount_usd: Decimal
    new_balance: Decimal
    tracking_code: str


@dataclass(frozen=True)
class CancelResult:
    invoice_id: int
    canceled: bool
    approved: bool
    approve_result: ApproveResult | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _quantize_usdt(value: Decimal | float | str) -> Decimal:
    return Decimal(str(value)).quantize(_AMOUNT_QUANT, rounding=ROUND_HALF_UP)


def format_exact_usdt(value: Decimal | float | str) -> str:
    """فرمت مبلغ دقیق با ۲ رقم اعشار (مثلاً ``1.04``)."""
    return format(_quantize_usdt(value), "f")


def format_tracking_code(invoice_id: int) -> str:
    return f"SP-{int(invoice_id)}"


def auth_headers(settings: SwapSettings) -> dict[str, str]:
    api_key = (settings.swappay_api_key or "").strip()
    if not api_key:
        raise SwapPayError("SWAPPAY_API_KEY is not configured")
    return {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }


def is_invoice_expired(
    created_at: datetime | None,
    *,
    now: datetime | None = None,
) -> bool:
    if created_at is None:
        return False
    current = now or datetime.now(timezone.utc)
    created = created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created < current - timedelta(hours=INVOICE_LIFETIME_HOURS)


def enforce_verify_cooldown(invoice_id: int) -> None:
    now = time.monotonic()
    last = _VERIFY_LAST.get(invoice_id, 0.0)
    if now - last < _VERIFY_COOLDOWN_SEC:
        raise SwappayVerifyRateLimited(
            "⏳ لطفاً کمی صبر کنید. استعلام دستی بعدی ۱ دقیقه دیگر امکان‌پذیر است..."
        )
    _VERIFY_LAST[invoice_id] = now


# ---------------------------------------------------------------------------
# Market / payment URL
# ---------------------------------------------------------------------------

async def get_live_usdt_irt_rate() -> float:
    """نرخ زنده USDT/IRT از ``GET /v1/market/prices``."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(f"{SWAPWALLET_API_BASE}/v1/market/prices")
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        raise ExchangePriceError("SwapWallet market prices request failed") from exc
    except (ValueError, TypeError) as exc:
        raise ExchangePriceError("SwapWallet market prices response invalid") from exc

    if not isinstance(data, dict):
        raise ExchangePriceError("SwapWallet market prices response is not an object")

    raw = data.get("USDT/IRT")
    if raw is None and isinstance(data.get("result"), dict):
        raw = data["result"].get("USDT/IRT")
    if raw is None:
        raise ExchangePriceError("USDT/IRT pair missing from SwapWallet prices")

    try:
        rate = float(str(raw).replace(",", "").strip())
    except ValueError as exc:
        raise ExchangePriceError("USDT/IRT price is not numeric") from exc
    if rate <= 0:
        raise ExchangePriceError("USDT/IRT price must be positive")
    return rate


def calculate_irt_amount(usdt_amount: Decimal, live_rate: float) -> int:
    """تخمین IRT از USDT × نرخ (بدون حاشیه)."""
    if live_rate <= 0:
        raise SwapPayError("Live USDT/IRT rate must be positive")
    return max(1, int(round(float(usdt_amount) * float(live_rate))))


def generate_smart_payment_url(
    address: str,
    amount: Decimal | float | str,
    *,
    network: str = "BSC",
) -> str:
    """لینک login که بعد از احراز به express-withdraw برمی‌گردد."""
    wallet = (address or "").strip()
    if not wallet:
        raise SwapPayError("SWAPPAY_WALLET_ADDRESS is not configured")

    net = (network or "BSC").strip() or "BSC"
    amount_str = format_exact_usdt(amount)
    query = urlencode(
        {
            "coin": "USDT",
            "network": net,
            "memo": "",
            "address": wallet,
            "amount": amount_str,
        }
    )
    relative_path = f"/express-withdraw?{query}"
    b64 = base64.b64encode(relative_path.encode("utf-8")).decode("ascii")
    next_url = quote(b64, safe="")
    return f"https://swapwallet.app/login?nextUrl={next_url}&step=ways"


def build_payment_url(settings: SwapSettings, exact_crypto_amount: Decimal) -> str:
    address = (settings.swappay_wallet_address or "").strip()
    network = (settings.swappay_wallet_network or "BSC").strip() or "BSC"
    return generate_smart_payment_url(address, exact_crypto_amount, network=network)


# ---------------------------------------------------------------------------
# Slot allocation
# ---------------------------------------------------------------------------

def _fraction_units_priority() -> list[int]:
    tier1 = list(range(_FRACTION_MIN_UNITS, _FRACTION_TIER1_MAX + 1))
    tier2 = list(range(_FRACTION_TIER1_MAX + 1, _FRACTION_MAX_UNITS + 1))
    return tier1 + tier2


async def allocate_unique_exact_amount(
    db: AsyncSession,
    base_usdt_amount: Decimal,
) -> Decimal:
    """کمترین اسلات آزاد ``base + frac`` با ۲ رقم اعشار.

    اولویت: ``+0.01…0.09`` سپس ``+0.10…0.99``.
    فقط PENDING اسلات را رزرو می‌کند.
    """
    if base_usdt_amount <= Decimal("0"):
        raise SwapPayError("Base USDT amount must be positive")

    base = _quantize_usdt(base_usdt_amount)
    lock_key = int(base * 100)
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:ns, :key)"),
        {"ns": _SLOT_ADVISORY_NS, "key": lock_key},
    )

    slot_min = _quantize_usdt(base + Decimal(_FRACTION_MIN_UNITS) / Decimal(100))
    slot_max = _quantize_usdt(base + Decimal(_FRACTION_MAX_UNITS) / Decimal(100))

    used_rows = await db.scalars(
        select(SwapWalletInvoice.exact_crypto_amount)
        .where(
            SwapWalletInvoice.status == SwapInvoiceStatus.PENDING,
            SwapWalletInvoice.exact_crypto_amount.is_not(None),
            SwapWalletInvoice.exact_crypto_amount >= slot_min,
            SwapWalletInvoice.exact_crypto_amount <= slot_max,
        )
        .with_for_update()
    )
    used = {_quantize_usdt(v) for v in used_rows if v is not None}

    for units in _fraction_units_priority():
        exact = _quantize_usdt(base + Decimal(units) / Decimal(100))
        if exact not in used:
            return exact

    raise SwapPayError(
        "تمام اسلات‌های مبلغ یکتای این بازه در حال استفاده است. "
        "لطفاً چند دقیقه دیگر دوباره تلاش کنید."
    )


# ---------------------------------------------------------------------------
# Deposit Detector API
# ---------------------------------------------------------------------------

def extract_usdt_amount_from_tx(item: dict[str, Any]) -> Decimal | None:
    """استخراج مبلغ USDT از ردیف Deposit Detector (فقط SUCCEED)."""
    if not isinstance(item, dict):
        return None
    if str(item.get("status") or "").upper() != "SUCCEED":
        return None

    for key in ("transfer", "cryptoDeposit", "crypto_deposit"):
        detail = item.get(key)
        if not isinstance(detail, dict):
            continue
        amount = detail.get("amount")
        if not isinstance(amount, dict):
            continue
        unit = str(amount.get("unit") or "").upper()
        if unit and unit != "USDT":
            continue
        raw = amount.get("number")
        if raw is None:
            continue
        try:
            value = _quantize_usdt(raw)
        except Exception:
            continue
        if value > Decimal("0"):
            return value
    return None


async def fetch_recent_usdt_deposits(
    settings: SwapSettings,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """``GET /v2/transaction`` — CRYPTO_DEPOSIT + TRANSFER، توکن USDT."""
    params = [
        ("types", "CRYPTO_DEPOSIT"),
        ("types", "TRANSFER"),
        ("tokens", "USDT"),
        ("sortDir", "DESC"),
        ("limit", str(limit)),
    ]
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{SWAPWALLET_API_BASE}/v2/transaction",
            headers=auth_headers(settings),
            params=params,
        )
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict) or payload.get("status") != "OK":
        logger.warning("SwapWallet deposit detector unexpected payload: %s", payload)
        return []

    result = payload.get("result")
    if isinstance(result, dict):
        data = result.get("data")
    else:
        data = result
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict)]


async def find_provider_deposit_match(
    settings: SwapSettings,
    exact_amount: Decimal,
    *,
    limit: int = 30,
) -> tuple[str | None, dict[str, Any] | None]:
    """جستجوی واریز SUCCEED با مبلغ دقیق — فقط از API (نه webhook کلاینت)."""
    exact = _quantize_usdt(exact_amount)
    if exact <= Decimal("0"):
        return None, None

    rows = await fetch_recent_usdt_deposits(settings, limit=limit)
    for item in rows:
        amount = extract_usdt_amount_from_tx(item)
        if amount is None or amount != exact:
            continue
        external_ref = str(item.get("id") or item.get("supportCode") or "").strip()[:128]
        if not external_ref:
            external_ref = f"SWDET-{exact}-{item.get('timestamp') or 'na'}"[:128]
        return external_ref, item
    return None, None


# ---------------------------------------------------------------------------
# Invoice CRUD
# ---------------------------------------------------------------------------

async def create_invoice(
    db: AsyncSession,
    settings: SwapSettings,
    *,
    user_id: int,
    amount_usd: Decimal,
) -> tuple[SwapWalletInvoice, str, Decimal]:
    """ساخت فاکتور PENDING و برگرداندن ``(invoice, pay_url, exact_amount)``."""
    if amount_usd <= Decimal("0"):
        raise SwapPayError("Top-up USD amount must be positive")
    if not (settings.swappay_wallet_address or "").strip():
        raise SwapPayError("SWAPPAY_WALLET_ADDRESS is not configured")

    last_error: Exception | None = None
    for attempt in range(1, _ALLOC_INSERT_RETRIES + 1):
        try:
            async with db.begin_nested():
                exact = await allocate_unique_exact_amount(db, amount_usd)
                pay_url = build_payment_url(settings, exact)
                placeholder = f"SWP{user_id}-{uuid.uuid4().hex[:8]}"

                inv = SwapWalletInvoice(
                    user_id=user_id,
                    amount_usd=amount_usd,
                    exact_crypto_amount=exact,
                    gateway=GATEWAY_SWAPWALLET,
                    status=SwapInvoiceStatus.PENDING,
                    tracking_code=placeholder,
                    payment_url=pay_url,
                )
                db.add(inv)
                await db.flush()
                inv.tracking_code = format_tracking_code(inv.id)
                db.add(inv)
                await db.flush()

            logger.info(
                "SwapPay invoice created user=%s id=%s tracking=%s usd=%s exact=%s",
                user_id,
                inv.id,
                inv.tracking_code,
                amount_usd,
                exact,
            )
            return inv, pay_url, exact
        except IntegrityError as exc:
            last_error = exc
            logger.warning(
                "SwapPay slot collision attempt=%s user=%s: %s",
                attempt,
                user_id,
                exc,
            )
            continue

    raise SwapPayError(
        "تمام اسلات‌های مبلغ یکتای این بازه در حال استفاده است. "
        "لطفاً چند دقیقه دیگر دوباره تلاش کنید."
    ) from last_error


async def find_active_pending_invoice(
    db: AsyncSession,
    user_id: int,
) -> SwapWalletInvoice | None:
    """فاکتور PENDING فعال کاربر در پنجره ۵ ساعته."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=INVOICE_LIFETIME_HOURS)
    inv = await db.scalar(
        select(SwapWalletInvoice)
        .where(
            SwapWalletInvoice.user_id == user_id,
            SwapWalletInvoice.status == SwapInvoiceStatus.PENDING,
            SwapWalletInvoice.created_at >= cutoff,
        )
        .order_by(SwapWalletInvoice.id.desc())
        .limit(1)
    )
    if inv is None:
        return None
    if is_invoice_expired(inv.created_at, now=now):
        inv.status = SwapInvoiceStatus.EXPIRED
        db.add(inv)
        await db.flush()
        return None
    return inv


async def find_pending_by_exact_amount(
    db: AsyncSession,
    exact_amount: Decimal,
) -> SwapWalletInvoice | None:
    exact = _quantize_usdt(exact_amount)
    return await db.scalar(
        select(SwapWalletInvoice)
        .where(
            SwapWalletInvoice.status == SwapInvoiceStatus.PENDING,
            SwapWalletInvoice.exact_crypto_amount == exact,
        )
        .order_by(SwapWalletInvoice.id.asc())
        .limit(1)
        .with_for_update()
    )


async def find_revive_candidate(
    db: AsyncSession,
    exact_amount: Decimal,
) -> SwapWalletInvoice | None:
    """فاکتور CANCELED/EXPIRED قابل احیا وقتی اسلات دوباره صادر نشده باشد."""
    exact = _quantize_usdt(exact_amount)
    pending = await db.scalar(
        select(SwapWalletInvoice.id)
        .where(
            SwapWalletInvoice.status == SwapInvoiceStatus.PENDING,
            SwapWalletInvoice.exact_crypto_amount == exact,
        )
        .limit(1)
    )
    if pending is not None:
        return None
    return await db.scalar(
        select(SwapWalletInvoice)
        .where(
            SwapWalletInvoice.status.in_(
                (SwapInvoiceStatus.CANCELED, SwapInvoiceStatus.EXPIRED)
            ),
            SwapWalletInvoice.exact_crypto_amount == exact,
        )
        .order_by(SwapWalletInvoice.id.desc())
        .limit(1)
        .with_for_update()
    )


async def _ref_already_credited(
    db: AsyncSession,
    provider_ref: str,
    *,
    exclude_invoice_id: int,
) -> bool:
    row = await db.scalar(
        select(SwapWalletInvoice.id)
        .where(
            SwapWalletInvoice.provider_ref == provider_ref,
            SwapWalletInvoice.status == SwapInvoiceStatus.SUCCESS,
            SwapWalletInvoice.id != exclude_invoice_id,
        )
        .limit(1)
    )
    return row is not None


async def approve_invoice(
    db: AsyncSession,
    invoice_id: int,
    *,
    on_credit: CreditCallback,
    external_ref: str | None = None,
    provider_confirmed: bool = False,
) -> ApproveResult:
    """تایید ایدمپوتنت فاکتور و شارژ کیف پول از طریق ``on_credit``."""
    inv = await db.scalar(
        select(SwapWalletInvoice)
        .where(SwapWalletInvoice.id == invoice_id)
        .with_for_update()
    )
    if inv is None:
        raise ValueError(f"Invoice not found: {invoice_id}")

    base_usd = Decimal(str(inv.amount_usd or "0"))
    credit_amount = _quantize_usdt(inv.exact_crypto_amount or base_usd)
    tracking = inv.tracking_code or format_tracking_code(invoice_id)

    if inv.status == SwapInvoiceStatus.SUCCESS:
        # already credited — balance lookup via on_credit not needed; return zeros-safe
        return ApproveResult(
            invoice_id=invoice_id,
            credited=False,
            already_verified=True,
            amount_usd=credit_amount if credit_amount > 0 else base_usd,
            new_balance=Decimal("0"),
            tracking_code=tracking,
        )

    if inv.status == SwapInvoiceStatus.FAILED:
        return ApproveResult(
            invoice_id=invoice_id,
            credited=False,
            already_verified=False,
            amount_usd=credit_amount if credit_amount > 0 else base_usd,
            new_balance=Decimal("0"),
            tracking_code=tracking,
        )

    is_override = inv.status in (
        SwapInvoiceStatus.CANCELED,
        SwapInvoiceStatus.EXPIRED,
    )
    if is_override:
        if not provider_confirmed:
            raise SwapPayError(
                "Override of CANCELED/EXPIRED requires live SwapWallet confirmation"
            )
        if not (external_ref or "").strip():
            raise SwapPayError(
                "Override of CANCELED/EXPIRED requires provider transaction id"
            )

    if inv.status == SwapInvoiceStatus.PENDING and is_invoice_expired(inv.created_at):
        if not provider_confirmed:
            inv.status = SwapInvoiceStatus.EXPIRED
            db.add(inv)
            await db.flush()
            return ApproveResult(
                invoice_id=invoice_id,
                credited=False,
                already_verified=False,
                amount_usd=credit_amount if credit_amount > 0 else base_usd,
                new_balance=Decimal("0"),
                tracking_code=tracking,
            )

    if credit_amount <= Decimal("0"):
        raise SwapPayError("Invoice is missing exact USDT amount")

    if not provider_confirmed:
        raise SwapPayError(
            "SwapPay credit requires server-to-server provider confirmation"
        )

    ref = (external_ref or "").strip()[:128] or None
    if not ref:
        raise SwapPayError("Provider transaction id is required for SwapPay credit")

    if await _ref_already_credited(db, ref, exclude_invoice_id=invoice_id):
        raise SwapPayError(
            "این تراکنش SwapWallet قبلاً برای فاکتور دیگری ثبت شده است."
        )

    inv.provider_ref = ref
    inv.amount_usd = credit_amount
    inv.status = SwapInvoiceStatus.SUCCESS
    db.add(inv)
    await db.flush()

    new_balance = await on_credit(db, inv.user_id, credit_amount, inv)

    logger.info(
        "SwapPay approved user=%s invoice=%s tracking=%s ref=%s amount=%s override=%s",
        inv.user_id,
        invoice_id,
        tracking,
        ref,
        format_exact_usdt(credit_amount),
        is_override,
    )

    return ApproveResult(
        invoice_id=invoice_id,
        credited=True,
        already_verified=False,
        amount_usd=credit_amount,
        new_balance=new_balance,
        tracking_code=tracking,
    )


async def verify_invoice(
    db: AsyncSession,
    settings: SwapSettings,
    *,
    invoice_id: int,
    user_id: int,
    on_credit: CreditCallback,
) -> ApproveResult | None:
    """استعلام دستی — همیشه از API SwapWallet، نه ادعای کلاینت."""
    inv = await db.get(SwapWalletInvoice, invoice_id)
    if inv is None:
        raise ValueError(f"Invoice not found: {invoice_id}")
    if inv.user_id != user_id:
        raise SwapPayError("این فاکتور متعلق به شما نیست.")

    if inv.status == SwapInvoiceStatus.SUCCESS:
        return await approve_invoice(
            db, invoice_id, on_credit=on_credit, provider_confirmed=True
        )
    if inv.status == SwapInvoiceStatus.FAILED:
        raise SwapPayError("این فاکتور ناموفق شده است.")

    exact = _quantize_usdt(inv.exact_crypto_amount or Decimal("0"))
    if exact <= Decimal("0"):
        raise SwapPayError("فاکتور مبلغ دقیق ندارد.")

    external_ref, _row = await find_provider_deposit_match(settings, exact)
    if external_ref is None and _row is None:
        if inv.status == SwapInvoiceStatus.PENDING and is_invoice_expired(inv.created_at):
            inv.status = SwapInvoiceStatus.EXPIRED
            db.add(inv)
            await db.flush()
            raise SwapPayError("این فاکتور منقضی شده است.")
        if inv.status in (SwapInvoiceStatus.CANCELED, SwapInvoiceStatus.EXPIRED):
            raise SwapPayError(
                "پرداختی در SwapWallet برای این فاکتور تایید نشده است."
            )
        return None

    return await approve_invoice(
        db,
        invoice_id,
        on_credit=on_credit,
        external_ref=external_ref,
        provider_confirmed=True,
    )


async def cancel_invoice(
    db: AsyncSession,
    settings: SwapSettings,
    *,
    invoice_id: int,
    user_id: int,
    on_credit: CreditCallback,
) -> CancelResult:
    """لغو PENDING پس از اطمینان S2S که پرداخت نشده؛ در صورت پرداخت → approve."""
    inv = await db.scalar(
        select(SwapWalletInvoice)
        .where(SwapWalletInvoice.id == invoice_id)
        .with_for_update()
    )
    if inv is None:
        raise ValueError(f"Invoice not found: {invoice_id}")
    if inv.user_id != user_id:
        raise SwapPayError("این فاکتور متعلق به شما نیست.")
    if inv.status == SwapInvoiceStatus.SUCCESS:
        raise SwapPayError("این فاکتور قبلاً تایید و شارژ شده است.")
    if inv.status != SwapInvoiceStatus.PENDING:
        raise SwapPayError("فقط فاکتورهای در انتظار قابل لغو هستند.")

    exact = _quantize_usdt(inv.exact_crypto_amount or Decimal("0"))
    external_ref, _row = await find_provider_deposit_match(settings, exact)
    if external_ref is not None or _row is not None:
        result = await approve_invoice(
            db,
            invoice_id,
            on_credit=on_credit,
            external_ref=external_ref,
            provider_confirmed=True,
        )
        return CancelResult(
            invoice_id=invoice_id,
            canceled=False,
            approved=bool(result.credited or result.already_verified),
            approve_result=result,
        )

    inv.status = SwapInvoiceStatus.CANCELED
    db.add(inv)
    await db.flush()
    logger.info("SwapPay canceled invoice=%s user=%s", invoice_id, user_id)
    return CancelResult(
        invoice_id=invoice_id,
        canceled=True,
        approved=False,
        approve_result=None,
    )


# ---------------------------------------------------------------------------
# Background polling
# ---------------------------------------------------------------------------

async def poll_deposits_once(
    session_factory: async_sessionmaker[AsyncSession],
    settings: SwapSettings,
    *,
    on_credit: CreditCallback,
    on_notify: NotifyCallback | None = None,
) -> int:
    """یک دور matching واریزهای اخیر با فاکتورهای PENDING.

    برمی‌گرداند: تعداد فاکتورهای تازه شارژشده.
    """
    if not (settings.swappay_api_key or "").strip():
        return 0
    if not (settings.swappay_wallet_address or "").strip():
        return 0

    credited_count = 0
    try:
        rows = await fetch_recent_usdt_deposits(settings, limit=20)
    except Exception:
        logger.exception("SwapWallet deposit detector fetch failed")
        return 0

    async with session_factory() as db:
        try:
            now = datetime.now(timezone.utc)
            expire_before = now - timedelta(hours=INVOICE_LIFETIME_HOURS)
            poll_since = now - timedelta(hours=POLL_ACTIVE_HOURS)

            expired = list(
                await db.scalars(
                    select(SwapWalletInvoice).where(
                        SwapWalletInvoice.status == SwapInvoiceStatus.PENDING,
                        SwapWalletInvoice.created_at < expire_before,
                    )
                )
            )
            for inv in expired:
                inv.status = SwapInvoiceStatus.EXPIRED
                db.add(inv)

            seen_amounts: set[Decimal] = set()
            for item in rows:
                amount = extract_usdt_amount_from_tx(item)
                if amount is None or amount in seen_amounts:
                    continue
                seen_amounts.add(amount)

                pending = await db.scalar(
                    select(SwapWalletInvoice)
                    .where(
                        SwapWalletInvoice.status == SwapInvoiceStatus.PENDING,
                        SwapWalletInvoice.exact_crypto_amount == amount,
                        SwapWalletInvoice.created_at >= poll_since,
                    )
                    .order_by(SwapWalletInvoice.id.asc())
                    .limit(1)
                    .with_for_update()
                )
                if pending is None:
                    pending = await find_revive_candidate(db, amount)
                if pending is None:
                    continue

                external_ref = str(
                    item.get("id") or item.get("supportCode") or ""
                ).strip()[:128]
                if not external_ref:
                    external_ref = f"SWDET-{amount}-{item.get('timestamp') or 'na'}"[:128]

                try:
                    result = await approve_invoice(
                        db,
                        pending.id,
                        on_credit=on_credit,
                        external_ref=external_ref,
                        provider_confirmed=True,
                    )
                except Exception:
                    logger.exception(
                        "SwapPay approve failed invoice_id=%s amount=%s",
                        pending.id,
                        amount,
                    )
                    continue

                if not result.credited:
                    continue

                credited_count += 1
                if on_notify is not None:
                    try:
                        await on_notify(
                            pending.user_id,
                            pending,
                            result.amount_usd,
                            result.new_balance,
                        )
                    except Exception:
                        logger.exception(
                            "SwapPay notify failed invoice_id=%s", pending.id
                        )

            await db.commit()
        except Exception:
            await db.rollback()
            raise

    if credited_count:
        logger.info("SwapPay polling credited %d invoice(s)", credited_count)
    return credited_count


async def polling_loop(
    session_factory: async_sessionmaker[AsyncSession],
    settings: SwapSettings,
    *,
    on_credit: CreditCallback,
    on_notify: NotifyCallback | None = None,
    interval_sec: int = 90,
) -> None:
    """حلقه همیشگی Deposit Detector."""
    while True:
        try:
            await poll_deposits_once(
                session_factory,
                settings,
                on_credit=on_credit,
                on_notify=on_notify,
            )
        except Exception:
            logger.exception("swappay polling_loop cycle failed")
        await asyncio.sleep(interval_sec)
