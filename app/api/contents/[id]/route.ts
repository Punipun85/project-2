import { getContentById } from "@/lib/content-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const content = await getContentById(id);

  if (!content) {
    return Response.json({ error: "Content not found" }, { status: 404 });
  }

  return Response.json({ data: content });
}
