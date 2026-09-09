import { POST as saveFavorite } from "@/app/api/user/favorites/route";

export async function POST(request: Request) {
  return saveFavorite(request);
}
