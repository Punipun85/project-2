"""Generate semantic embeddings for normalized content NDJSON."""

import argparse
import json
import os

from models import NormalizedContent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--output", default="embedded_contents.ndjson")
    parser.add_argument("--model", default=os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"))
    args = parser.parse_args()
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as error:
        raise SystemExit("Install data-pipeline/requirements.txt before generating embeddings") from error
    model = SentenceTransformer(args.model)
    records: list[NormalizedContent] = []
    with open(args.input, encoding="utf-8") as source:
        for line in source:
            if line.strip():
                records.append(NormalizedContent(**json.loads(line)))
    vectors = model.encode([record.embedding_text() for record in records], normalize_embeddings=True)
    with open(args.output, "w", encoding="utf-8") as output:
        for record, vector in zip(records, vectors, strict=True):
            record.embedding = vector.tolist()
            output.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
