import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userPreferences, users } from "@/db/schema";
import { defaultProfile } from "@/lib/recommendation";

const json = (value: unknown) => JSON.stringify(value ?? []);

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId") ?? "demo-user";

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    if (rows[0]) return Response.json({ data: rows[0] });
  } catch {
    // A fresh local preview uses the default profile until D1 is initialized.
  }

  return Response.json({ data: { userId, ...defaultProfile }, meta: { persisted: false } });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        userId?: string;
        name?: string;
        email?: string;
        favoriteContentTypes?: string[];
        preferredLanguages?: string[];
        favoriteGenres?: string[];
        favoriteCountries?: string[];
        dislikedGenres?: string[];
        moodProfile?: Record<string, unknown>;
      }
    | null;

  if (!body?.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const db = getDb();
    await db
      .insert(users)
      .values({
        id: body.userId,
        name: body.name ?? "EntertainmentAI User",
        email: body.email ?? `${body.userId}@local.entertainment.ai`,
      })
      .onConflictDoNothing();

    const values = {
      userId: body.userId,
      favoriteContentTypes: json(body.favoriteContentTypes),
      preferredLanguages: json(body.preferredLanguages),
      favoriteGenres: json(body.favoriteGenres),
      favoriteCountries: json(body.favoriteCountries),
      dislikedGenres: json(body.dislikedGenres),
      moodProfile: json(body.moodProfile ?? {}),
      updatedAt: new Date().toISOString(),
    };

    await db
      .insert(userPreferences)
      .values(values)
      .onConflictDoUpdate({ target: userPreferences.userId, set: values });

    return Response.json({ data: values, meta: { persisted: true } });
  } catch (error) {
    return Response.json(
      { error: "Persistence is unavailable", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 503 },
    );
  }
}
