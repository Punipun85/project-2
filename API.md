# EntertainmentAI API

The hosted web application exposes `/api/*`. The FastAPI service exposes the same resources without the `/api` prefix.

## List content

`GET /api/contents?type=anime&search=titan&limit=24`

Supported types: `movie`, `anime`, `kdrama`, `series`, `documentary`.

```json
{
  "data": [
    {
      "id": "anime-attack-on-titan",
      "type": "anime",
      "title": "Attack on Titan",
      "language": "Japanese",
      "episodes": 25,
      "studio": "Wit Studio"
    }
  ],
  "meta": { "count": 1, "type": "anime", "search": "titan" }
}
```

## Content detail

`GET /api/contents/{id}`

Returns `404` when the identifier is unknown.

## Recommendations

`GET /api/recommendations?type=kdrama&limit=12`

Every item includes:

```json
{
  "scores": {
    "content": 0.91,
    "collaborative": 0.86,
    "final": 0.89
  },
  "reason": "A sweeping romance with the emotional payoff you tend to finish."
}
```

The response metadata declares `universal-hybrid-v1` and the `0.6/0.4` weights.

## Semantic search

`POST /api/search/semantic`

```json
{
  "query": "anime with a genius protagonist",
  "limit": 6
}
```

The response includes detected intent, semantic score, final score, and an explanation for each result.

## AI assistant

`POST /api/ai/chat`

```json
{
  "userId": "user_123",
  "message": "I want something emotional like Your Name and Twenty Five Twenty One"
}
```

```json
{
  "answer": "I found Your Name, Twenty Five Twenty One, Crash Landing on You...",
  "intent": {
    "contentTypes": [],
    "languages": [],
    "themes": ["Emotional"]
  },
  "recommendations": []
}
```

## Preferences

`GET /api/user/preferences?userId=user_123`

`PUT /api/user/preferences`

```json
{
  "userId": "user_123",
  "name": "Alex Rivera",
  "email": "alex@example.com",
  "favoriteContentTypes": ["movie", "anime", "kdrama"],
  "preferredLanguages": ["English", "Japanese", "Korean"],
  "favoriteGenres": ["Sci-Fi", "Drama", "Romance"],
  "favoriteCountries": ["Japan", "South Korea"]
}
```

## Error format

```json
{
  "error": "Unsupported content type"
}
```

Validation errors use `400`, missing records use `404`, and unavailable persistence uses `503`.
