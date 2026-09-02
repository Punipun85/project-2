"""Official MyAnimeList API v2 importer with OAuth token support."""

from __future__ import annotations

import datetime as dt
from typing import Any

import requests
from tenacity import Retrying, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from config.settings import Settings, get_settings
from sources.http_client import JsonApiClient


MAL_API_BASE_URL = "https://api.myanimelist.net/v2"
MAL_TOKEN_URL = "https://myanimelist.net/v1/oauth2/token"
MAL_DETAIL_FIELDS = ",".join(
    (
        "id",
        "title",
        "main_picture",
        "alternative_titles",
        "start_date",
        "end_date",
        "synopsis",
        "mean",
        "rank",
        "popularity",
        "num_list_users",
        "num_scoring_users",
        "media_type",
        "status",
        "genres",
        "num_episodes",
        "start_season",
        "source",
        "average_episode_duration",
        "rating",
        "studios",
    )
)


class MalAnimeClient:
    """MAL client using app client ID and optional OAuth bearer/refresh tokens."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        client_id = self.settings.require_mal()
        headers = {"X-MAL-CLIENT-ID": client_id}
        if self.settings.mal_access_token:
            headers["Authorization"] = f"Bearer {self.settings.mal_access_token}"
        self.api = JsonApiClient(
            base_url=MAL_API_BASE_URL,
            timeout=self.settings.http_timeout_seconds,
            retries=self.settings.request_retries,
            request_delay=self.settings.mal_request_delay,
            headers=headers,
        )

    def get(self, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            return self.api.get(path, params=params)
        except requests.HTTPError as error:
            if (
                error.response is None
                or error.response.status_code != 401
                or not self.settings.mal_refresh_token
            ):
                raise
            token = refresh_access_token(self.settings, self.settings.mal_refresh_token)
            self.api.session.headers["Authorization"] = f"Bearer {token['access_token']}"
            return self.api.get(path, params=params)


def get_top_anime(
    page: int = 1,
    *,
    limit: int = 100,
    client: MalAnimeClient | None = None,
) -> list[dict[str, Any]]:
    """Return one page from MAL's all-anime ranking."""

    if page < 1:
        raise ValueError("page harus bernilai minimal 1")
    page_size = max(1, min(limit, 100))
    api = client or MalAnimeClient()
    payload = api.get(
        "anime/ranking",
        params={
            "ranking_type": "all",
            "limit": page_size,
            "offset": (page - 1) * page_size,
            "fields": MAL_DETAIL_FIELDS,
        },
    )
    return _unwrap_nodes(payload)


def get_seasonal_anime(
    year: int | None = None,
    season: str | None = None,
    *,
    page: int = 1,
    limit: int = 100,
    client: MalAnimeClient | None = None,
) -> list[dict[str, Any]]:
    """Return one page of anime for a MAL season."""

    current_year, current_season = current_anime_season()
    selected_year = year or current_year
    selected_season = (season or current_season).lower()
    if selected_season not in {"winter", "spring", "summer", "fall"}:
        raise ValueError("season harus winter, spring, summer, atau fall")
    if page < 1:
        raise ValueError("page harus bernilai minimal 1")
    page_size = max(1, min(limit, 100))
    api = client or MalAnimeClient()
    payload = api.get(
        f"anime/season/{selected_year}/{selected_season}",
        params={
            "limit": page_size,
            "offset": (page - 1) * page_size,
            "sort": "anime_num_list_users",
            "fields": MAL_DETAIL_FIELDS,
        },
    )
    return _unwrap_nodes(payload)


def get_anime_detail(
    anime_id: int | str,
    *,
    client: MalAnimeClient | None = None,
) -> dict[str, Any]:
    api = client or MalAnimeClient()
    return api.get(f"anime/{anime_id}", params={"fields": MAL_DETAIL_FIELDS})


def exchange_authorization_code(
    settings: Settings,
    *,
    code: str,
    code_verifier: str,
    redirect_uri: str | None = None,
) -> dict[str, Any]:
    """Exchange an OAuth authorization code produced by MAL's PKCE flow."""

    data: dict[str, str] = {
        "client_id": settings.require_mal(),
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
    }
    if settings.mal_client_secret:
        data["client_secret"] = settings.mal_client_secret
    selected_redirect = redirect_uri or settings.mal_redirect_uri
    if selected_redirect:
        data["redirect_uri"] = selected_redirect
    return _post_token(settings, data)


def refresh_access_token(settings: Settings, refresh_token: str) -> dict[str, Any]:
    """Refresh an expired MAL OAuth token for unattended repeated imports."""

    data = {
        "client_id": settings.require_mal(),
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    if settings.mal_client_secret:
        data["client_secret"] = settings.mal_client_secret
    return _post_token(settings, data)


def current_anime_season(today: dt.date | None = None) -> tuple[int, str]:
    selected = today or dt.date.today()
    season = ("winter", "spring", "summer", "fall")[(selected.month - 1) // 3]
    return selected.year, season


def _post_token(settings: Settings, data: dict[str, str]) -> dict[str, Any]:
    retrying = Retrying(
        stop=stop_after_attempt(settings.request_retries),
        wait=wait_exponential_jitter(initial=0.5, max=15),
        retry=retry_if_exception_type((requests.Timeout, requests.ConnectionError)),
        reraise=True,
    )
    for attempt in retrying:
        with attempt:
            response = requests.post(
                MAL_TOKEN_URL,
                data=data,
                headers={"Accept": "application/json"},
                timeout=settings.http_timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not payload.get("access_token"):
                raise RuntimeError("Respons token OAuth MAL tidak valid")
            return payload
    raise RuntimeError("OAuth MAL gagal tanpa respons")


def _unwrap_nodes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in payload.get("data", []):
        if not isinstance(item, dict):
            continue
        node = item.get("node")
        if not isinstance(node, dict):
            continue
        row = dict(node)
        if isinstance(item.get("ranking"), dict):
            row["ranking"] = item["ranking"]
        rows.append(row)
    return rows
