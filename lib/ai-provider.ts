import { env } from "cloudflare:workers";

type AIRuntimeEnv = {
  OLLAMA_CHAT_URL?: string;
  OLLAMA_MODEL?: string;
  REMOTE_AI_BASE_URL?: string;
  REMOTE_AI_API_KEY?: string;
  REMOTE_AI_MODEL?: string;
};

type Candidate = {
  title: string;
  type: string;
  genres: string[];
  themes: string[];
  reason: string;
};

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type OllamaChatResponse = {
  message?: { content?: string };
};

type OpenAICompatibleResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type AIProviderResult = {
  answer: string | null;
  provider: "ollama" | "openai-compatible" | "deterministic-fallback";
  model: string | null;
};

function buildMessages(message: string, candidates: Candidate[]): ChatMessage[] {
  const candidateContext = candidates.map((candidate) => ({
    title: candidate.title,
    type: candidate.type,
    genres: candidate.genres,
    themes: candidate.themes,
    recommendationReason: candidate.reason,
  }));

  return [
    {
      role: "system",
      content:
        "You are Lumi, EntertainmentAI's concise entertainment curator. Answer in the same language as the user. Recommend only titles from the supplied candidates, explain the fit using supplied metadata, and never invent titles, cast, ratings, or availability. Use a warm natural tone and at most two short paragraphs.",
    },
    {
      role: "user",
      content: `User request: ${message}\n\nRanked candidates:\n${JSON.stringify(candidateContext)}`,
    },
  ];
}

async function askOllama(
  endpoint: string,
  model: string,
  messages: ChatMessage[],
): Promise<string | null> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "10m",
        options: { temperature: 0.55, num_predict: 220 },
        messages,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as OllamaChatResponse;
    return payload.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

async function askOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<string | null> {
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.55,
          max_tokens: 220,
        }),
        signal: AbortSignal.timeout(35_000),
      },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as OpenAICompatibleResponse;
    return payload.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function askAI({
  message,
  candidates,
}: {
  message: string;
  candidates: Candidate[];
}): Promise<AIProviderResult> {
  const runtimeEnv = env as unknown as AIRuntimeEnv;
  const messages = buildMessages(message, candidates);
  const ollamaEndpoint = runtimeEnv.OLLAMA_CHAT_URL?.trim();
  const ollamaModel = runtimeEnv.OLLAMA_MODEL?.trim() || "qwen2.5:3b";

  if (ollamaEndpoint) {
    const answer = await askOllama(ollamaEndpoint, ollamaModel, messages);
    if (answer) return { answer, provider: "ollama", model: ollamaModel };
  }

  const remoteBaseUrl = runtimeEnv.REMOTE_AI_BASE_URL?.trim();
  const remoteApiKey = runtimeEnv.REMOTE_AI_API_KEY?.trim();
  const remoteModel = runtimeEnv.REMOTE_AI_MODEL?.trim();
  if (remoteBaseUrl && remoteApiKey && remoteModel) {
    const answer = await askOpenAICompatible(
      remoteBaseUrl,
      remoteApiKey,
      remoteModel,
      messages,
    );
    if (answer) {
      return {
        answer,
        provider: "openai-compatible",
        model: remoteModel,
      };
    }
  }

  return { answer: null, provider: "deterministic-fallback", model: null };
}
