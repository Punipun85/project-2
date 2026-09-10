import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroundedFallbackAnswer,
  buildRecommendationMessages,
} from "../lib/ai/client";
import {
  createEmbeddingConfig,
  EmbeddingError,
  generateEmbedding,
} from "../lib/embedding-client";
import {
  rankFallbackContents,
  searchVectorContents,
  type VectorContentRow,
} from "../lib/vector-search";
import { buildEmbeddingDocument } from "../scripts/generate-embeddings";

const vector = Array.from({ length: 384 }, () => 0.05);
const embeddingConfig = createEmbeddingConfig({
  EMBEDDING_API_URL: "https://embedding.example/ai/embed",
  EMBEDDING_API_KEY: "test-key",
  EMBEDDING_MODEL: "sentence-transformers/all-MiniLM-L6-v2",
});
const supabaseConfig = {
  url: "https://project.supabase.co",
  anonKey: "public-anon-key",
  isConfigured: true,
} as const;

function embeddingFetch(): Promise<Response> {
  return Promise.resolve(
    Response.json({
      embedding: vector,
      model: "sentence-transformers/all-MiniLM-L6-v2",
      dimension: 384,
    }),
  );
}

test("embedding client sends Bearer auth and validates a 384-value response", async () => {
  const input = "anime fantasy with powerful main character";
  const result = await generateEmbedding(input, {
    config: embeddingConfig,
    fetchImplementation: async (requestUrl, init) => {
      assert.equal(String(requestUrl), "https://embedding.example/ai/embed");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-key",
      );
      assert.deepEqual(JSON.parse(String(init?.body)), { text: input });
      return embeddingFetch();
    },
  });

  assert.equal(result.length, 384);
});

test("embedding client reports service timeouts without exposing credentials", async () => {
  await assert.rejects(
    generateEmbedding("timeout test", {
      config: embeddingConfig,
      timeoutMs: 5,
      fetchImplementation: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    }),
    (error: unknown) => error instanceof EmbeddingError && error.code === "timeout",
  );
});

test("missing embedding environment returns the required configuration error", async () => {
  await assert.rejects(
    generateEmbedding("query", { config: createEmbeddingConfig({}) }),
    (error: unknown) =>
      error instanceof EmbeddingError &&
      error.code === "not_configured" &&
      error.message === "Missing required environment variable: EMBEDDING_API_URL",
  );
});

test("ingestion document includes catalog metadata and normalized characters", () => {
  const document = buildEmbeddingDocument(
    {
      id: 1,
      title: "Frieren",
      overview: "A fantasy adventure after the hero's journey.",
      genres: ["Fantasy", "Adventure"],
      keywords: ["magic"],
      cast: [{ name: "Atsumi Tanezaki" }],
      content_type: "anime",
      release_year: 2023,
    },
    [{ content_id: 1, characters: { name: "Fern", description: "A young mage." } }],
  );

  assert.match(document, /Title: Frieren/);
  assert.match(document, /Genres: Fantasy, Adventure/);
  assert.match(document, /Characters: Fern, A young mage\./);
  assert.match(document, /Metadata: anime, 2023/);
});

function rpcFetch(rows: VectorContentRow[]): typeof fetch {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      query_embedding: number[];
      match_threshold: number;
    };
    assert.equal(request.query_embedding.length, 384);
    assert.equal(request.match_threshold, 0.2);
    return Response.json(rows);
  };
}

test("semantic anime query returns a vector-ranked overpowered protagonist title", async () => {
  const results = await searchVectorContents(
    "anime with overpowered main character",
    3,
    {
      embeddingConfig,
      supabaseConfig,
      embeddingFetch: embeddingFetch as typeof fetch,
      supabaseFetch: rpcFetch([
        {
          id: 1,
          external_id: "5114",
          source: "JIKAN",
          title: "Fullmetal Alchemist: Brotherhood",
          content_type: "anime",
          overview: "Two brothers use alchemy while seeking the Philosopher's Stone.",
          genres: ["Action", "Fantasy"],
          characters: [{ name: "Edward Elric" }],
          similarity: 0.82,
        },
        {
          id: 2,
          external_id: "30276",
          source: "JIKAN",
          title: "One Punch Man",
          content_type: "anime",
          overview: "An overwhelmingly powerful hero searches for a worthy challenge.",
          genres: ["Action", "Comedy"],
          themes: ["overpowered protagonist", "superheroes"],
          characters: [{ name: "Saitama" }],
          similarity: 0.94,
        },
      ]),
    },
  );

  assert.equal(results[0].content.title, "One Punch Man");
  assert.ok(results[0].similarity > results[1].similarity);
});

test("semantic search ranks a genius anime character hiding power", async () => {
  const results = await searchVectorContents(
    "anime about genius character hiding power",
    3,
    {
      embeddingConfig,
      supabaseConfig,
      embeddingFetch: embeddingFetch as typeof fetch,
      supabaseFetch: rpcFetch([
        {
          id: 10,
          external_id: "1535",
          source: "MAL",
          title: "Death Note",
          content_type: "anime",
          overview: "A genius student hides a supernatural power while facing a detective.",
          genres: ["Mystery", "Thriller"],
          characters: [{ name: "Light Yagami" }],
          rating_average: 8.6,
          rating_count: 3000000,
          popularity_score: 99,
          similarity: 0.95,
        },
        {
          id: 11,
          external_id: "1575",
          source: "MAL",
          title: "Code Geass",
          content_type: "anime",
          overview: "A brilliant strategist conceals his identity and supernatural command power.",
          genres: ["Action", "Drama"],
          characters: [{ name: "Lelouch Lamperouge" }],
          rating_average: 8.7,
          rating_count: 2000000,
          popularity_score: 95,
          similarity: 0.93,
        },
      ]),
    },
  );

  assert.equal(results[0].content.title, "Death Note");
  assert.ok(results.every((result) => result.content.type === "anime"));
});

test("semantic movie query returns AI and human-emotion context without exact title", async () => {
  const results = await searchVectorContents(
    "movie about artificial intelligence and human emotion",
    3,
    {
      embeddingConfig,
      supabaseConfig,
      embeddingFetch: embeddingFetch as typeof fetch,
      supabaseFetch: rpcFetch([
        {
          id: 3,
          external_id: "264660",
          source: "TMDB",
          title: "Ex Machina",
          content_type: "movie",
          overview: "A programmer evaluates a sentient humanoid artificial intelligence.",
          genres: ["Science Fiction", "Drama"],
          themes: ["consciousness", "human emotion"],
          cast: [{ name: "Alicia Vikander" }],
          similarity: 0.93,
        },
      ]),
    },
  );

  assert.equal(results[0].content.title, "Ex Machina");
  assert.match(results[0].explanation, /semantically close/i);
});

test("RAG prompt grounds why-recommend answers in retrieved evidence", () => {
  const messages = buildRecommendationMessages("Why do you recommend this?", [
    {
      title: "Death Note",
      type: "anime",
      genres: ["Mystery", "Thriller"],
      themes: ["justice", "strategy"],
      reason: "High semantic match for a genius strategist.",
      overview: "A gifted student enters a battle of wits.",
      characters: ["Light Yagami", "L"],
      similarity: 0.94,
    },
  ]);

  assert.match(messages[0].content, /metadata.*supports/i);
  assert.match(messages[1].content, /Death Note/);
  assert.match(messages[1].content, /Light Yagami/);
  assert.match(messages[1].content, /0\.94/);
});

test("RAG prompt answers why Frieren should be watched from NexaPlay context", () => {
  const messages = buildRecommendationMessages("Why should I watch Frieren?", [
    {
      title: "Frieren: Beyond Journey's End",
      type: "anime",
      genres: ["Fantasy", "Adventure", "Drama"],
      themes: ["grief", "time", "friendship"],
      reason: "It matches reflective fantasy and character-driven stories.",
      overview: "An elven mage learns to understand human lives after the hero's journey.",
      rating: 9.3,
      characters: ["Frieren", "Fern"],
      similarity: 0.97,
    },
  ]);

  assert.match(messages[1].content, /Frieren: Beyond Journey's End/);
  assert.match(messages[1].content, /reflective fantasy/);
  assert.match(messages[1].content, /Frieren.*Fern/);
});

test("unknown content produces an explicit unavailable-information fallback", () => {
  const answer = buildGroundedFallbackAnswer([]);
  assert.match(answer, /don't have enough verified NexaPlay catalog information/i);

  const messages = buildRecommendationMessages("Tell me about an unknown title", []);
  assert.match(messages[0].content, /information is unavailable in NexaPlay/i);
});

test("metadata and popularity fallback is used only with supplied fallback records", () => {
  const results = rankFallbackContents([
    {
      id: "1",
      externalId: "1",
      provider: "mal",
      type: "anime",
      title: "Death Note",
      description: "A genius student hides a supernatural power.",
      posterUrl: "poster.jpg",
      backdropUrl: "backdrop.jpg",
      genres: ["Mystery"],
      themes: ["strategy"],
      language: "Japanese",
      country: "Japan",
      releaseYear: 2006,
      cast: [],
      rating: 8.6,
      popularity: 99,
      match: 0,
      reason: "",
    },
  ], "genius hiding power", 5, { requireQueryMatch: true });

  assert.equal(results[0].content.title, "Death Note");
  assert.equal(results[0].similarity, 0);
  assert.ok(results[0].popularityScore > 0);
});
