"""
Telegram session tuning.

Why this module exists
----------------------
``aiohttp`` resolves DNS and tries addresses in the order the OS returns them.
On hosts with a *half-configured* IPv6 stack — Windows servers and containers
are the usual culprits — the first attempt is an IPv6 address that silently
black-holes, and the request dies with::

    ClientConnectorError: Cannot connect to host api.telegram.org:443
    [The semaphore timeout period has expired]

which looks exactly like "Telegram is down" and is very much not.

So the bot pins the address family it dials, configurable per deployment:

    TELEGRAM_IP_FAMILY=ipv4   # the safe default on most servers
    TELEGRAM_IP_FAMILY=any    # keep the OS behaviour (IPv6 + IPv4 fallback)
"""

from __future__ import annotations

import logging
import os
import socket

from aiogram.client.session.aiohttp import AiohttpSession

logger = logging.getLogger(__name__)

FAMILIES = {"ipv4": socket.AF_INET, "ipv6": socket.AF_INET6, "any": socket.AF_UNSPEC}


def build_session() -> AiohttpSession:
    """An aiogram session that dials the address family this host can reach."""
    requested = os.getenv("TELEGRAM_IP_FAMILY", "ipv4").strip().lower()
    family = FAMILIES.get(requested, socket.AF_INET)

    session = AiohttpSession()
    if family is not socket.AF_UNSPEC:
        # aiohttp's connector init is the supported seam for this
        session._connector_init["family"] = family  # noqa: SLF001
        logger.info(
            "Telegram session pinned to %s (TELEGRAM_IP_FAMILY=%s)",
            socket.AddressFamily(family).name,
            requested,
        )
    return session


__all__ = ["build_session", "FAMILIES"]
