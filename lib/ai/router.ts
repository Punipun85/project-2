import { aiConfig, type AIConfig } from "./config";

export type AITaskType = "default" | "reasoning" | "fallback";

const REASONING_PATTERNS = [
  /\b(analy[sz]e|analysis|reason deeply|complex|detailed)\b/i,
  /\b(watching|watch|viewing) history\b/i,
  /\b(my|user) (anime |movie |watching )?preferences?\b/i,
  /\b(compare|comparison|versus|vs\.?|differences?)\b/i,
  /\b(analisis|analisa|menganalisis|bandingkan|perbandingan|preferensi)\b/i,
  /\b(riwayat|histori) (tontonan|menonton)\b/i,
];

export function selectAIModel(
  taskType: AITaskType,
  config: AIConfig = aiConfig,
): string {
  if (taskType === "reasoning") return config.reasoningModel;
  if (taskType === "fallback") return config.fallbackModel;
  return config.defaultModel;
}

export function classifyAITask(message: string): Exclude<AITaskType, "fallback"> {
  return REASONING_PATTERNS.some((pattern) => pattern.test(message))
    ? "reasoning"
    : "default";
}
