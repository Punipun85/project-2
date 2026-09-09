export type LogCategory = "api" | "ai" | "pipeline" | "database" | "security";

export function logStructured(
  level: "info" | "warn" | "error",
  category: LogCategory,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    category,
    event,
    ...fields,
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export function safeErrorType(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (error instanceof Error) return error.name || "Error";
  return "unknown_error";
}
