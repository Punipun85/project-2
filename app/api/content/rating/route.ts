import { PUT as saveRating } from "@/app/api/user/ratings/route";

export async function POST(request: Request) {
  return saveRating(request);
}
