"""مدل‌های SQLAlchemy مستقل برای فاکتورهای شارژ Swap Wallet.

این جدول مخصوص درگاه Swap Wallet است و به پنل/کسب‌وکار Outbound وابسته نیست.
در پروژه مقصد، ``Base`` را با Base خودتان جایگزین کنید یا از همین Base ارث ببرید.
"""
from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base مستقل — در پروژه خودتان می‌توانید حذف و از Base اصلی استفاده کنید."""


class SwapInvoiceStatus(str, enum.Enum):
    PENDING = "PENDING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"
    CANCELED = "CANCELED"


GATEWAY_SWAPWALLET = "SWAPWALLET"


def _pg_enum(enum_class: type[enum.Enum], name: str) -> Enum:
    return Enum(
        enum_class,
        name=name,
        native_enum=True,
        values_callable=lambda members: [member.value for member in members],
    )


class SwapWalletInvoice(Base):
    """فاکتور شارژ کیف پول از طریق Swap Wallet (مبلغ کسری یکتا برای matching).

    Matching با ``exact_crypto_amount`` انجام می‌شود (مثلاً 5.03 USDT).
    ``amount_usd`` مبلغ پایه درخواستی کاربر است (مثلاً 5.00).
    """

    __tablename__ = "swap_wallet_invoices"
    __table_args__ = (
        # یک فاکتور PENDING برای هر مبلغ دقیق (اسلات یکتا)
        Index(
            "uq_swap_invoice_pending_exact_crypto",
            "exact_crypto_amount",
            unique=True,
            postgresql_where=text(
                "status = 'PENDING' AND exact_crypto_amount IS NOT NULL"
            ),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # شناسه کاربر در جدول users پروژه مقصد
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # مبلغ پایه درخواستی (USD) — قبل از افزودن کسر یکتا
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)

    # مبلغ دقیق واریز که کاربر باید بپردازد (base + fraction، دو رقم اعشار)
    exact_crypto_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8), nullable=True, index=True
    )

    gateway: Mapped[str] = mapped_column(
        String(32), nullable=False, default=GATEWAY_SWAPWALLET
    )
    status: Mapped[SwapInvoiceStatus] = mapped_column(
        _pg_enum(SwapInvoiceStatus, "swapinvoicestatus"),
        nullable=False,
        default=SwapInvoiceStatus.PENDING,
    )

    # کد پیگیری نمایشی به کاربر (مثلاً SP-42)
    tracking_code: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )

    # شناسه تراکنش SwapWallet پس از تایید (ضد double-credit)
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # لینک پرداخت express-withdraw (اختیاری؛ قابل بازسازی از amount)
    payment_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return (
            f"<SwapWalletInvoice id={self.id} user_id={self.user_id} "
            f"exact={self.exact_crypto_amount} status={self.status}>"
        )


# ---------------------------------------------------------------------------
# SQL خام برای مهاجرت دستی (اگر Alembic ندارید):
#
# CREATE TYPE swapinvoicestatus AS ENUM
#   ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELED');
#
# CREATE TABLE swap_wallet_invoices (
#   id SERIAL PRIMARY KEY,
#   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
#   amount_usd NUMERIC(18, 8) NOT NULL,
#   exact_crypto_amount NUMERIC(18, 8),
#   gateway VARCHAR(32) NOT NULL DEFAULT 'SWAPWALLET',
#   status swapinvoicestatus NOT NULL DEFAULT 'PENDING',
#   tracking_code VARCHAR(64) NOT NULL UNIQUE,
#   provider_ref VARCHAR(128),
#   payment_url VARCHAR(1024),
#   note TEXT,
#   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
#   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
# );
#
# CREATE UNIQUE INDEX uq_swap_invoice_pending_exact_crypto
#   ON swap_wallet_invoices (exact_crypto_amount)
#   WHERE status = 'PENDING' AND exact_crypto_amount IS NOT NULL;
#
# CREATE INDEX ix_swap_wallet_invoices_user_id ON swap_wallet_invoices (user_id);
# CREATE INDEX ix_swap_wallet_invoices_exact ON swap_wallet_invoices (exact_crypto_amount);
# ---------------------------------------------------------------------------
