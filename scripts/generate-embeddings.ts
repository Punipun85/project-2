import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireEnvironmentValue } from "../lib/env";
import {
  createEmbeddingConfig,
  generateEmbedding,
} from "../lib/embedding-client";

type ContentRow = {
  id: number;
  title: string;
  original_title?: string | null;
  overview?: string | null;
  ai_summary?: string | null;
  content_type?: string | null;
  series_type?: string | null;
  release_year?: number | null;
  genres?: unknown;
  themes?: unknown;
  moods?: unknown;
  keywords?: unknown;
  director?: unknown;
  cast?: unknown;
  characters?: unknown;
};

type CharacterRelation = {
  content_id: number;
  characters?: { name?: string; description?: string } | null;
};

function values(input: unknown): string[] {
  if (!input) return [];
  if (typeof input === "string") {
    try {
      return values(JSON.parse(input));
    } catch {
      return input.trim() ? [input.trim()] : [];
    }
  }
  if (Array.isArray(input)) return input.flatMap(values);
  if (typeof input === "object") {
    return Object.values(input as Record<string, unknown>).flatMap((value) =>
      typeof value === "string" || typeof value === "number" ? [String(value)] : [],
    );
  }
  return [String(input)];
}

export function buildEmbeddingDocument(
  content: ContentRow,
  relatedCharacters: CharacterRelation[] = [],
): string {
  const sections: Array<[string, string[]]> = [
    ["Title", values([content.title, content.original_title])],
    ["Description", values([content.overview, content.ai_summary])],
    ["Genres", values(content.genres)],
    ["Themes", values(content.themes)],
    ["Moods", values(content.moods)],
    ["Keywords", values(content.keywords)],
    ["Director", values(content.director)],
    ["Cast", values(content.cast)],
    [
      "Characters",
      [
        ...values(content.characters),
        ...relatedCharacters.flatMap((relation) =>
          values([relation.characters?.name, relation.characters?.description]),
        ),
      ],
    ],
    [
      "Metadata",
      values([content.content_type, content.series_type, content.release_year]),
    ],
  ];
  return sections
    .filter(([, items]) => items.length)
    .map(([label, items]) => `${label}: ${items.join(", ")}`)
    .join("\n");
}

type Runtime = { supabaseUrl: string; headers: Record<string, string> };

function createRuntime(): Runtime {
  const supabaseUrl = requireEnvironmentValue("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY");
  return {
    supabaseUrl,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
  };
}

async function rest(runtime: Runtime, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${runtime.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...runtime.headers, ...init.headers },
  });
}

async function loadPendingContents(runtime: Runtime): Promise<ContentRow[]> {
  const rows: ContentRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: [
        "id", "title", "original_title", "overview", "ai_summary",
        "content_type", "series_type", "release_year", "genres", "themes",
        "moods", "keywords", "director", "cast", "characters",
      ].join(","),
      is_active: "eq.true",
      or: "(embedding.is.null,embedding_status.neq.completed)",
      order: "id.asc",
      offset: String(offset),
      limit: String(pageSize),
    });
    const response = await rest(runtime, `contents?${query}`);
    if (!response.ok) throw new Error(`Could not load contents: HTTP ${response.status}`);
    const page = (await response.json()) as ContentRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function loadCharacters(runtime: Runtime, contentIds: number[]): Promise<Map<number, CharacterRelation[]>> {
  const grouped = new Map<number, CharacterRelation[]>();
  for (let start = 0; start < contentIds.length; start += 100) {
    const ids = contentIds.slice(start, start + 100);
    const query = new URLSearchParams({
      select: "content_id,characters(name,description)",
      content_id: `in.(${ids.join(",")})`,
    });
    const response = await rest(runtime, `content_characters?${query}`);
    if (!response.ok) continue;
    for (const relation of (await response.json()) as CharacterRelation[]) {
      const items = grouped.get(relation.content_id) ?? [];
      items.push(relation);
      grouped.set(relation.content_id, items);
    }
  }
  return grouped;
}

async function updateContent(runtime: Runtime, id: number, body: Record<string, unknown>): Promise<void> {
  const response = await rest(runtime, `contents?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Could not update content ${id}: HTTP ${response.status}`);
}

async function main(): Promise<void> {
  const runtime = createRuntime();
  const embeddingConfig = createEmbeddingConfig();
  if (!embeddingConfig.isConfigured) throw new Error("Embedding service is not configured");
  const contents = await loadPendingContents(runtime);
  const characters = await loadCharacters(runtime, contents.map((content) => content.id));
  const result = { processed: 0, success: 0, failed: 0 };
  console.info(`Embedding ingestion discovered=${contents.length}`);

  for (const content of contents) {
    result.processed += 1;
    try {
      await updateContent(runtime, content.id, {
        embedding_status: "processing",
        embedding_error: null,
      });
      const document = buildEmbeddingDocument(content, characters.get(content.id));
      const embedding = await generateEmbedding(document, { config: embeddingConfig });
      await updateContent(runtime, content.id, {
        embedding,
        embedding_status: "completed",
        embedded_at: new Date().toISOString(),
        embedding_model: embeddingConfig.model,
        embedding_source_hash: createHash("sha256").update(document).digest("hex"),
        embedding_error: null,
      });
      result.success += 1;
      console.info(`Embedded content_id=${content.id}`);
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
      console.error(`Embedding failed content_id=${content.id} error=${message}`);
      try {
        await updateContent(runtime, content.id, {
          embedding_status: "failed",
          embedding_error: message,
        });
      } catch {
        console.error(`Could not persist failure content_id=${content.id}`);
      }
    }
  }

  console.info(
    `Embedding ingestion complete processed=${result.processed} success=${result.success} failed=${result.failed}`,
  );
  if (result.failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
