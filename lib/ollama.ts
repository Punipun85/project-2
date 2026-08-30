import { env } from "cloudflare:workers";

type OllamaRuntimeEnv = {
  OLLAMA_CHAT_URL?: string;
  OLLAMA_MODEL?: string;
};

type Candidate = {
  title: string;
  type: string;
  genres: string[];
  themes: string[];
  reason: string;
};

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

export type OllamaResult = {
  answer: string | null;
  provider: "ollama" | "deterministic-fallback";
  model: string | null;
};

export async function askOllama({
  message,
  candidates,
}: {
  message: string;
  candidates: Candidate[];
}): Promise<OllamaResult> {
  const runtimeEnv = env as unknown as OllamaRuntimeEnv;
  const endpoint = runtimeEnv.OLLAMA_CHAT_URL?.trim();
  const model = runtimeEnv.OLLAMA_MODEL?.trim() || "qwen2.5:3b";

  if (!endpoint) {
    return { answer: null, provider: "deterministic-fallback", model: null };
  }

  const candidateContext = candidates.map((candidate) => ({
    title: candidate.title,
    type: candidate.type,
    genres: candidate.genres,
    themes: candidate.themes,
    recommendationReason: candidate.reason,
  }));

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "10m",
        options: { temperature: 0.55, num_predict: 220 },
        messages: [
          {
            role: "system",
            content:
              "You are Lumi, EntertainmentAI's concise entertainment curator. Answer in the same language as the user. Recommend only titles from the supplied candidates, explain the fit using supplied metadata, and never invent titles, cast, ratings, or availability. Use a warm natural tone and at most two short paragraphs.",
          },
          {
            role: "user",
            content: `User request: ${message}\n\nRanked candidates:\n${JSON.stringify(candidateContext)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) return { answer: null, provider: "deterministic-fallback", model };

    const payload = (await response.json()) as OllamaChatResponse;
    const answer = payload.message?.content?.trim();
    return answer
      ? { answer, provider: "ollama", model }
      : { answer: null, provider: "deterministic-fallback", model };
  } catch {
    return { answer: null, provider: "deterministic-fallback", model };
  }
}
