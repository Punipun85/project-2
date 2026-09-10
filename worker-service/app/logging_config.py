import json
import logging
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "category": getattr(record, "category", "pipeline"),
            "event": getattr(record, "event", record.getMessage()),
            "logger": record.name,
        }
        for key in ("job", "duration_ms", "error_type", "status"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=getattr(logging, level, logging.INFO), handlers=[handler], force=True)
