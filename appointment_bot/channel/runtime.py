"""
Runtime holder for the channel client.

aiogram handlers receive ``(message, state)`` — there is no place to inject a
dependency. Instead the client is created once during start-up and published
here, which keeps the handlers importable and testable: a test sets a fake
client with :func:`set_api` and never touches the network.
"""

from __future__ import annotations

import logging

from channel.api import ChannelApi

logger = logging.getLogger(__name__)

_api: ChannelApi | None = None


def set_api(client: ChannelApi) -> None:
    global _api
    _api = client
    logger.info("Channel client ready → %s", client.base_url)


def get_api() -> ChannelApi:
    """The shared client. Raises if the bot was started without one."""
    if _api is None:
        raise RuntimeError(
            "the channel client is not initialised — set_api() must run at start-up"
        )
    return _api


def has_api() -> bool:
    return _api is not None


async def close_api() -> None:
    global _api
    if _api is not None:
        await _api.aclose()
        _api = None


__all__ = ["set_api", "get_api", "has_api", "close_api"]
