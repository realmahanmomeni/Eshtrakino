"""روتر aiogram V3 برای جریان شارژ کیف پول با Swap Wallet.

وابستگی‌های Outbound (پنل، UniquePay، crypto gateways، …) حذف شده‌اند.
در پروژه مقصد باید:
- ``get_settings`` / ``get_session`` / ``get_user`` را با DI خودتان وصل کنید
- ``on_credit`` را برای افزایش موجودی پیاده کنید
- روتر را با ``dp.include_router(swap_router)`` ثبت کنید
"""
from __future__ import annotations

import html
import logging
from decimal import Decimal, InvalidOperation
from typing import Any, Awaitable, Callable

from aiogram import F, Router
from aiogram.filters.callback_data import CallbackData
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy.ext.asyncio import AsyncSession

from swap_api import (
    CreditCallback,
    SwapPayError,
    SwapSettings,
    SwappayVerifyRateLimited,
    build_payment_url,
    cancel_invoice,
    create_invoice,
    enforce_verify_cooldown,
    find_active_pending_invoice,
    format_exact_usdt,
    verify_invoice,
)
from swap_models import SwapWalletInvoice

logger = logging.getLogger(__name__)

swap_router = Router(name="swap_wallet")


# ---------------------------------------------------------------------------
# CallbackData
# ---------------------------------------------------------------------------

class SelectSwapAmountCallback(CallbackData, prefix="swap_amt"):
    amount_usd: float


class VerifySwapCallback(CallbackData, prefix="verify_swappay"):
    invoice_id: int


class OpenSwapInvoiceCallback(CallbackData, prefix="open_swappay"):
    invoice_id: int


class CancelSwapCallback(CallbackData, prefix="cancel_swappay"):
    invoice_id: int


# ---------------------------------------------------------------------------
# Wiring hooks — در startup پروژه مقصد مقداردهی کنید
# ---------------------------------------------------------------------------

_settings: SwapSettings | None = None
_on_credit: CreditCallback | None = None

# مبالغ پیش‌فرض قابل سفارشی‌سازی
DEFAULT_DEPOSIT_AMOUNTS: list[Decimal] = [
    Decimal("5"),
    Decimal("10"),
    Decimal("20"),
    Decimal("50"),
]


def configure_swap_handlers(
    *,
    settings: SwapSettings,
    on_credit: CreditCallback,
) -> None:
    """قبل از include_router فراخوانی شود."""
    global _settings, _on_credit
    _settings = settings
    _on_credit = on_credit


def _require_wiring() -> tuple[SwapSettings, CreditCallback]:
    if _settings is None or _on_credit is None:
        raise RuntimeError(
            "swap_handlers.configure_swap_handlers() must be called at startup"
        )
    return _settings, _on_credit


# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------

def deposit_amounts_keyboard(
    amounts: list[Decimal] | None = None,
    *,
    back_callback: str = "main_menu",
) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for amt in amounts or DEFAULT_DEPOSIT_AMOUNTS:
        label = format(amt, "f").rstrip("0").rstrip(".")
        kb.row(
            InlineKeyboardButton(
                text=f"💵 ${label}",
                callback_data=SelectSwapAmountCallback(amount_usd=float(amt)).pack(),
            )
        )
    kb.row(InlineKeyboardButton(text="🔙 بازگشت", callback_data=back_callback))
    return kb.as_markup()


def invoice_text(inv: SwapWalletInvoice) -> str:
    exact = inv.exact_crypto_amount or inv.amount_usd or Decimal("0")
    exact_str = html.escape(format_exact_usdt(exact))
    tracking = html.escape(str(inv.tracking_code or f"SP-{inv.id}"))
    return (
        "✅ <b>فاکتور پرداخت ریالی (Swap Wallet)</b>\n\n"
        f"🔢 کد پیگیری: <code>{tracking}</code>\n"
        f"💵 مبلغ دقیق واریز: <b>{exact_str} USDT</b>\n\n"
        "✅ سیستم به‌صورت خودکار واریزی شما را در کمتر از ۵ دقیقه تایید می‌کند.\n\n"
        "⏳ مهلت پرداخت این فاکتور حداکثر ۵ ساعت می‌باشد. "
        "(پس از گذشت این زمان، لطفاً فاکتور جدیدی ایجاد کنید)"
    )


def invoice_keyboard(
    payment_link: str,
    invoice_id: int,
    *,
    back_callback: str = "main_menu",
) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    pay_url = (payment_link or "").strip()
    if pay_url.startswith(("http://", "https://")):
        kb.row(
            InlineKeyboardButton(
                text="💳 پرداخت آنلاین",
                url=pay_url,
            )
        )
    kb.row(
        InlineKeyboardButton(
            text="🔄 بررسی وضعیت پرداخت",
            callback_data=VerifySwapCallback(invoice_id=invoice_id).pack(),
        )
    )
    kb.row(
        InlineKeyboardButton(
            text="❌ لغو فاکتور",
            callback_data=CancelSwapCallback(invoice_id=invoice_id).pack(),
        )
    )
    kb.row(InlineKeyboardButton(text="🔙 بازگشت", callback_data=back_callback))
    return kb.as_markup()


async def _safe_edit(
    message: Message | None,
    text: str,
    *,
    reply_markup: InlineKeyboardMarkup | None = None,
    parse_mode: str = "HTML",
) -> None:
    if message is None:
        return
    try:
        await message.edit_text(text, reply_markup=reply_markup, parse_mode=parse_mode)
    except Exception:
        await message.answer(text, reply_markup=reply_markup, parse_mode=parse_mode)


def _fmt_usd(amount: Decimal) -> str:
    return format_exact_usdt(amount)


async def render_invoice(
    event: CallbackQuery | Message,
    inv: SwapWalletInvoice,
    settings: SwapSettings,
    *,
    notice: str | None = None,
) -> None:
    exact = inv.exact_crypto_amount or inv.amount_usd or Decimal("0")
    pay_url = (inv.payment_url or "").strip() or build_payment_url(settings, exact)
    text = invoice_text(inv)
    if notice:
        text = f"{notice}\n\n{text}"
    markup = invoice_keyboard(pay_url, inv.id)
    target = event.message if isinstance(event, CallbackQuery) else event
    if isinstance(event, CallbackQuery):
        await _safe_edit(target, text, reply_markup=markup)
        await event.answer()
    else:
        await target.answer(text, reply_markup=markup, parse_mode="HTML")


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

@swap_router.callback_query(F.data == "swap_deposit")
async def cb_open_deposit_menu(cb: CallbackQuery) -> None:
    """نقطه ورود: دکمه «شارژ با Swap Wallet» با callback_data=swap_deposit."""
    await _safe_edit(
        cb.message,
        "💳 <b>شارژ کیف پول با Swap Wallet</b>\n\n"
        "مبلغ واریزی را انتخاب کنید (به دلار):\n\n"
        "پس از انتخاب، فاکتور با مبلغ دقیق (کسری یکتا) ساخته می‌شود "
        "و لینک پرداخت ریالی در اختیار شما قرار می‌گیرد.",
        reply_markup=deposit_amounts_keyboard(),
    )
    await cb.answer()


@swap_router.callback_query(SelectSwapAmountCallback.filter())
async def cb_create_invoice(
    cb: CallbackQuery,
    callback_data: SelectSwapAmountCallback,
    db: AsyncSession,
    db_user: Any,
) -> None:
    """
    ساخت فاکتور.

    middleware پروژه باید ``db: AsyncSession`` و ``db_user`` (با فیلد ``.id``)
    را تزریق کند — همان الگوی رایج aiogram V3.
    """
    settings, _on_credit = _require_wiring()
    user_id = int(db_user.id)

    try:
        amount_usd = Decimal(str(callback_data.amount_usd)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        await cb.answer("مبلغ نامعتبر است.", show_alert=True)
        return

    if amount_usd <= 0:
        await cb.answer("مبلغ باید بزرگ‌تر از صفر باشد.", show_alert=True)
        return

    active = await find_active_pending_invoice(db, user_id)
    if active is not None:
        await render_invoice(
            cb,
            active,
            settings,
            notice=(
                "⚠️ شما یک فاکتور باز دارید. "
                "ابتدا آن را پرداخت یا لغو کنید."
            ),
        )
        return

    try:
        inv, _pay_url, _exact = await create_invoice(
            db,
            settings,
            user_id=user_id,
            amount_usd=amount_usd,
        )
        await db.commit()
    except SwapPayError as exc:
        logger.warning("SwapPay invoice error: %s", exc)
        await _safe_edit(
            cb.message,
            f"❌ <b>خطا در ایجاد فاکتور</b>\n\n{html.escape(str(exc))}",
            reply_markup=deposit_amounts_keyboard(),
        )
        await cb.answer()
        return
    except Exception:
        await db.rollback()
        logger.exception("SwapPay invoice creation failed")
        await cb.answer("خطای داخلی. لطفاً دوباره تلاش کنید.", show_alert=True)
        return

    await render_invoice(cb, inv, settings)


@swap_router.callback_query(VerifySwapCallback.filter())
async def cb_verify_payment(
    cb: CallbackQuery,
    callback_data: VerifySwapCallback,
    db: AsyncSession,
    db_user: Any,
) -> None:
    settings, on_credit = _require_wiring()
    invoice_id = int(callback_data.invoice_id)
    user_id = int(db_user.id)

    try:
        enforce_verify_cooldown(invoice_id)
    except SwappayVerifyRateLimited as exc:
        await cb.answer(str(exc), show_alert=False)
        return

    try:
        result = await verify_invoice(
            db,
            settings,
            invoice_id=invoice_id,
            user_id=user_id,
            on_credit=on_credit,
        )
        await db.commit()
    except SwapPayError as exc:
        logger.warning(
            "SwapPay verify error invoice=%s user=%s: %s",
            invoice_id,
            user_id,
            exc,
        )
        await cb.answer(str(exc), show_alert=True)
        return
    except Exception:
        await db.rollback()
        logger.exception(
            "SwapPay verify unexpected error invoice=%s user=%s",
            invoice_id,
            user_id,
        )
        await cb.answer("خطای داخلی. لطفاً دوباره تلاش کنید.", show_alert=True)
        return

    if result is None:
        await cb.answer(
            "❌ هنوز واریزی با این مبلغ دقیق به حساب ما ننشسته است. "
            "(اگر تازه واریز کردید، ۱ تا ۳ دقیقه زمان می‌برد)",
            show_alert=True,
        )
        return

    usd_str = html.escape(_fmt_usd(result.amount_usd))
    bal_str = html.escape(_fmt_usd(result.new_balance or Decimal("0")))
    tracking = html.escape(result.tracking_code)
    text = (
        "✅ <b>پرداخت تایید شد</b>\n\n"
        f"🔢 کد پیگیری: <code>{tracking}</code>\n"
        f"💵 مبلغ: <b>{usd_str} USDT</b>\n"
        f"💰 موجودی جدید: <b>{bal_str} USDT</b>"
    )
    kb = InlineKeyboardBuilder()
    kb.row(InlineKeyboardButton(text="🔙 بازگشت", callback_data="main_menu"))
    await _safe_edit(cb.message, text, reply_markup=kb.as_markup())
    await cb.answer("پرداخت تأیید شد ✅")


@swap_router.callback_query(OpenSwapInvoiceCallback.filter())
async def cb_open_invoice(
    cb: CallbackQuery,
    callback_data: OpenSwapInvoiceCallback,
    db: AsyncSession,
    db_user: Any,
) -> None:
    settings, _ = _require_wiring()
    user_id = int(db_user.id)
    invoice_id = int(callback_data.invoice_id)

    active = await find_active_pending_invoice(db, user_id)
    if active is None or active.id != invoice_id:
        await cb.answer("فاکتور فعالی یافت نشد یا منقضی شده است.", show_alert=True)
        return
    await render_invoice(cb, active, settings)


@swap_router.callback_query(CancelSwapCallback.filter())
async def cb_cancel_invoice(
    cb: CallbackQuery,
    callback_data: CancelSwapCallback,
    db: AsyncSession,
    db_user: Any,
) -> None:
    settings, on_credit = _require_wiring()
    invoice_id = int(callback_data.invoice_id)
    user_id = int(db_user.id)

    try:
        result = await cancel_invoice(
            db,
            settings,
            invoice_id=invoice_id,
            user_id=user_id,
            on_credit=on_credit,
        )
        await db.commit()
    except SwapPayError as exc:
        await cb.answer(str(exc), show_alert=True)
        return
    except Exception:
        await db.rollback()
        logger.exception(
            "SwapPay cancel unexpected error invoice=%s user=%s",
            invoice_id,
            user_id,
        )
        await cb.answer("خطای داخلی. لطفاً دوباره تلاش کنید.", show_alert=True)
        return

    if result.approved and result.approve_result is not None:
        ar = result.approve_result
        usd_str = html.escape(_fmt_usd(ar.amount_usd))
        bal_str = html.escape(_fmt_usd(ar.new_balance or Decimal("0")))
        text = (
            "✅ پرداخت شما قبل از لغو تایید شد و کیف پول شارژ شد.\n\n"
            f"💵 مبلغ: <b>{usd_str} USDT</b>\n"
            f"💰 موجودی جدید: <b>{bal_str} USDT</b>"
        )
        kb = InlineKeyboardBuilder()
        kb.row(InlineKeyboardButton(text="🔙 بازگشت", callback_data="main_menu"))
        await _safe_edit(cb.message, text, reply_markup=kb.as_markup())
        await cb.answer("پرداخت تأیید شد ✅")
        return

    await _safe_edit(
        cb.message,
        "❌ فاکتور لغو شد.\n\nمی‌توانید فاکتور جدیدی بسازید.",
        reply_markup=deposit_amounts_keyboard(),
    )
    await cb.answer("فاکتور لغو شد")


# ---------------------------------------------------------------------------
# نمونه on_credit برای کپی در پروژه مقصد
# ---------------------------------------------------------------------------

async def example_on_credit(
    db: AsyncSession,
    user_id: int,
    amount: Decimal,
    invoice: SwapWalletInvoice,
) -> Decimal:
    """نمونه: موجودی کاربر را افزایش دهید و موجودی جدید را برگردانید.

    از این تابع به‌عنوان الگو استفاده کنید — جدول ``users`` پروژه خودتان را به‌روز کنید.
    """
    # from your_app.models import User
    # user = await db.get(User, user_id, with_for_update=True)
    # user.balance = Decimal(str(user.balance or 0)) + amount
    # db.add(user)
    # await db.flush()
    # return Decimal(str(user.balance))
    raise NotImplementedError("Wire example_on_credit to your User.balance logic")
