import { requestAIChat, type AIChatMessage } from "@/lib/ai/client";
import { createAIConfig } from "@/lib/ai/config";
import { buildDeterministicExplanation, getContentExperience, jsonLabels } from "@/lib/content-experience";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

async function rows(response: Response): Promise<Row[]> {
  if (!response.ok) return [];
  const payload = await response.json().catch(() => []);
  return Array.isArray(payload) ? payload : [];
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const content = await getContentExperience(request, id, { resolveTrailer: false });
  if (!content) return Response.json({ error: "Content not found" }, { status: 404 });
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  let tasteGenres: string[] = [];
  let styles: string[] = [];
  let positiveTitles: string[] = [];

  if (session) {
    const userId = session.user.id;
    const [taste, ratings, history] = await Promise.all([
      restFetch(config, session.token, `user_taste_profiles?select=genre_scores,styles&user_id=eq.${userId}&limit=1`).then(rows),
      restFetch(config, session.token, `ratings?select=rating,contents(title)&user_id=eq.${userId}&rating=gte.4&order=rating.desc&limit=5`).then(rows),
      restFetch(config, session.token, `watch_history?select=completed,progress,contents(title)&user_id=eq.${userId}&order=last_watched.desc&limit=5`).then(rows),
    ]);
    const genreScores = taste[0]?.genre_scores;
    tasteGenres = genreScores && typeof genreScores === "object" && !Array.isArray(genreScores)
      ? Object.entries(genreScores as Record<string, unknown>)
        .filter(([, score]) => Number(score) >= 0.35)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([genre]) => genre)
      : [];
    styles = jsonLabels(taste[0]?.styles);
    positiveTitles = [...ratings, ...history.filter((row) => row.completed || Number(row.progress) >= 80)]
      .flatMap((row) => {
        const nested = Array.isArray(row.contents) ? row.contents[0] : row.contents;
        return nested && typeof nested === "object" && typeof (nested as Row).title === "string"
          ? [String((nested as Row).title)]
          : [];
      })
      .filter((title, index, values) => values.indexOf(title) === index)
      .slice(0, 5);
  }

  const deterministic = buildDeterministicExplanation(content, tasteGenres, styles, positiveTitles);
  const messages: AIChatMessage[] = [
    {
      role: "system",
      content: "You are Lumi, NexaPlay AI's recommendation explainer. Produce one concise sentence in the user's language. Use only the supplied content and taste evidence. Never invent viewing activity or metadata.",
    },
    {
      role: "user",
      content: `Explain why this user should watch the title. Evidence: ${JSON.stringify({
        content: {
          title: content.title,
          type: content.type,
          genres: content.genres,
          themes: content.themes,
          rating: content.rating,
          overview: content.description,
          characters: content.characters.slice(0, 8).map((character) => character.name),
        },
        userTaste: session ? { genres: tasteGenres, styles, positivelyRatedOrWatched: positiveTitles } : null,
      })}`,
    },
  ];
  const ai = await requestAIChat({ config: createAIConfig(), taskType: "default", messages });
  return Response.json({
    data: {
      explanation: ai.answer ?? deterministic,
      personalized: Boolean(session && (tasteGenres.length || positiveTitles.length)),
      provider: ai.provider,
      model: ai.model,
      fallbackUsed: !ai.answer,
    },
  });
}
