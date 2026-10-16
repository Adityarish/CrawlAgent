"""Run the JobAtlas crawler with ``python -m crawler``."""

import asyncio

from .runner import main


if __name__ == "__main__":
    asyncio.run(main())
