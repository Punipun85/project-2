# EntertainmentAI

EntertainmentAI extends MovieRecs AI into a universal entertainment recommendation platform for movies, anime, K-drama, TV series, and documentaries.

## Run the hosted web profile

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

```bash
npm run build
npm test
npm run lint
npm run db:generate
```

## Run the FastAPI profile

```bash
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

## Recommendation tests

```bash
python -m unittest discover -s ml-service/tests -v
```

## Data synchronization

```bash
pip install -r data-pipeline/requirements.txt
python data-pipeline/anime_sync.py --pages 2
python data-pipeline/tmdb_sync.py --type kdrama --pages 2
python data-pipeline/content_embedding.py anime_contents.ndjson
```

TMDB synchronization requires `TMDB_API_TOKEN`. The AI service uses `OLLAMA_BASE_URL` and `OLLAMA_MODEL`.

See [PRD.md](./PRD.md), [TDD.md](./TDD.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and [API.md](./API.md) for the product and technical contracts.
