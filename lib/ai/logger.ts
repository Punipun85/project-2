import type { AITaskType } from "./router";

type AILogEvent = {
  model: string;
  taskType: AITaskType;
  durationMs: number;
  success: boolean;
  errorType: string | null;
};

export function logAIRequest(event: AILogEvent): void {
  // Deliberately exclude API keys, prompts, responses, user IDs, and candidates.
  console.info(
    JSON.stringify({
      event: "remote_ai_request",
      model: event.model,
      taskType: event.taskType,
      durationMs: Math.round(event.durationMs),
      success: event.success,
      errorType: event.errorType,
    }),
  );
}
