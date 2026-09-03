import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const d1Binding = (globalThis as { DB?: unknown }).DB;
  if (!d1Binding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable in this runtime."
    );
  }

  return drizzle(d1Binding as Parameters<typeof drizzle>[0], { schema });
}
