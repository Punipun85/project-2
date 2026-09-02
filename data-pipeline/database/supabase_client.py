"""Create the trusted Supabase service-role client used by the pipeline."""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from config.settings import Settings, get_settings


@lru_cache(maxsize=1)
def _cached_client() -> Client:
    return _create_client(get_settings())


def get_supabase_client(settings: Settings | None = None) -> Client:
    """Return a Supabase client and surface configuration/creation failures clearly."""

    if settings is None:
        return _cached_client()
    return _create_client(settings)


def _create_client(settings: Settings) -> Client:
    url, service_role_key = settings.require_supabase()
    try:
        return create_client(url, service_role_key)
    except Exception as error:
        raise RuntimeError(f"Gagal membuat koneksi Supabase: {error}") from error
