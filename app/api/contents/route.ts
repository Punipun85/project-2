import { listContents } from "@/lib/content-service";
import { contentTypes, type ContentType } from "@/lib/content-types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const search = url.searchParams.get("search")?.trim() || undefined;
  const parsedLimit = Number(url.searchParams.get("limit") ?? 24);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 24;

  if (typeParam && !contentTypes.includes(typeParam as ContentType)) {
    return Response.json(
      { error: "Unsupported content type", supportedTypes: contentTypes },
      { status: 400 },
    );
  }

  const items = await listContents({
    type: typeParam as ContentType | undefined,
    search,
    limit,
  });

  return Response.json({
    data: items,
    meta: { count: items.length, type: typeParam ?? "all", search: search ?? null },
  });
}
