FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/huggingface \
    EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2 \
    PORT=8000

WORKDIR /service

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Cache the immutable default model in the image so production startup does not
# depend on Hugging Face availability. EMBEDDING_MODEL can still be overridden, but
# another model must be made available to the container separately.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

RUN addgroup --system nexaplay \
    && adduser --system --ingroup nexaplay --home /service nexaplay \
    && chown -R nexaplay:nexaplay /service /opt/huggingface

COPY --chown=nexaplay:nexaplay app ./app

USER nexaplay
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
