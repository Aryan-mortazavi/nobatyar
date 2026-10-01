"""
Run ONLY the web panel (without the Telegram bot):

    python -m web

Useful while developing the interface or when the bot token is not available.
"""

from __future__ import annotations

import uvicorn

from config import WEB_HOST, WEB_PORT, setup_logging
from web.app import create_app


def main() -> None:
    setup_logging()
    app = create_app()
    print(f"Web admin panel -> http://{WEB_HOST}:{WEB_PORT}")
    uvicorn.run(app, host=WEB_HOST, port=WEB_PORT, log_level="info")


if __name__ == "__main__":
    main()
