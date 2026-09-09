import { ContentExperiencePage } from "@/components/content/content-experience-page";

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContentExperiencePage id={id} />;
}
