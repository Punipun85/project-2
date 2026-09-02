"""Small rate-limited HTTP client with retry support."""

from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Any

import requests
from tenacity import Retrying, retry_if_exception, stop_after_attempt, wait_exponential_jitter


LOGGER = logging.getLogger(__name__)
RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


def _retryable(error: BaseException) -> bool:
    if isinstance(error, (requests.Timeout, requests.ConnectionError)):
        return True
    if isinstance(error, requests.HTTPError) and error.response is not None:
        return error.response.status_code in RETRYABLE_STATUS
    return False


class JsonApiClient:
    """Requests JSON while enforcing a minimum delay between API calls."""

    def __init__(
        self,
        *,
        base_url: str,
        timeout: float,
        retries: int,
        request_delay: float,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retries = retries
        self.request_delay = request_delay
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": "NexaPlayAI-DataPipeline/1.0",
                **(headers or {}),
            }
        )
        self._last_request = 0.0
        self._rate_lock = Lock()

    def get(self, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.base_url}/{path.lstrip('/')}"
        retrying = Retrying(
            stop=stop_after_attempt(self.retries),
            wait=wait_exponential_jitter(initial=0.5, max=15),
            retry=retry_if_exception(_retryable),
            reraise=True,
            before_sleep=lambda state: LOGGER.warning(
                "Retry API %s setelah error: %s",
                url,
                state.outcome.exception() if state.outcome else "unknown",
            ),
        )
        for attempt in retrying:
            with attempt:
                self._wait_for_rate_limit()
                response = self.session.get(url, params=params, timeout=self.timeout)
                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            time.sleep(min(float(retry_after), 30.0))
                        except ValueError:
                            pass
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise RuntimeError(f"Respons JSON tidak valid dari {url}")
                return payload
        raise RuntimeError(f"Permintaan API gagal tanpa respons: {url}")

    def _wait_for_rate_limit(self) -> None:
        with self._rate_lock:
            remaining = self.request_delay - (time.monotonic() - self._last_request)
            if remaining > 0:
                time.sleep(remaining)
            self._last_request = time.monotonic()
