"""نمونه تنظیمات Swap Wallet برای پروژه aiogram + SQLAlchemy.

مقادیر را در `.env` قرار دهید و با pydantic-settings (یا معادل) بارگذاری کنید.
کلید API را از اپلیکیشن SwapWallet بسازید (Bearer personal API key).
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class SwapWalletSettings(BaseSettings):
    """تنظیمات لازم برای ماژول شارژ کیف پول از طریق Swap Wallet."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # کلید شخصی API (هدر Authorization: Bearer …)
    swappay_api_key: str = ""

    # آدرس مقصد USDT برای express-withdraw (واریز کاربر به این آدرس)
    swappay_wallet_address: str = ""

    # شبکه بلاکچین مقصد (معمولاً BSC)
    swappay_wallet_network: str = "BSC"

    # اختیاری: فاصله polling دیتکتور واریز (ثانیه)
    swappay_poll_interval_sec: int = 90


# نمونه استفاده در پروژه مقصد:
#
#   from config_example import SwapWalletSettings
#   settings = SwapWalletSettings()
#
# متغیرهای محیطی متناظر:
#   SWAPPAY_API_KEY=apikey-…
#   SWAPPAY_WALLET_ADDRESS=0x…
#   SWAPPAY_WALLET_NETWORK=BSC
#   SWAPPAY_POLL_INTERVAL_SEC=90
