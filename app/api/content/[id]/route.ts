import { getContentExperience } from "@/lib/content-experience";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const content = await getContentExperience(request, id);
  return content
    ? Response.json({ data: content })
    : Response.json({ error: "Content not found" }, { status: 404 });
}
