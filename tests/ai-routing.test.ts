import assert from "node:assert/strict";
import test from "node:test";

import { AIRequestError, executeWithFallback } from "../lib/ai/client";
import { createAIConfig } from "../lib/ai/config";
import { classifyAITask, selectAIModel } from "../lib/ai/router";

const config = createAIConfig({
  REMOTE_AI_DEFAULT_MODEL: "ag/gemini-3.7-flash-high",
  REMOTE_AI_REASONING_MODEL: "cx/gpt-5.6-sol",
  REMOTE_AI_FALLBACK_MODEL: "cx/gpt-5.6-terra",
});

test("routes a normal anime recommendation to Gemini Flash", () => {
  const taskType = classifyAITask("Recommend anime similar to Frieren");

  assert.equal(taskType, "default");
  assert.equal(selectAIModel(taskType, config), "ag/gemini-3.7-flash-high");
});

test("routes watching-history analysis to the reasoning model", () => {
  const taskType = classifyAITask(
    "Analyze my watching history and explain my anime preference",
  );

  assert.equal(taskType, "reasoning");
  assert.equal(selectAIModel(taskType, config), "cx/gpt-5.6-sol");
});

test("retries one qualifying failure with the fallback model", async () => {
  const attemptedModels: string[] = [];
  const result = await executeWithFallback(
    "default",
    config,
    async (model) => {
      attemptedModels.push(model);
      if (attemptedModels.length === 1) {
        throw new AIRequestError("http_server_error", true);
      }
      return "fallback response";
    },
  );

  assert.deepEqual(attemptedModels, [
    "ag/gemini-3.7-flash-high",
    "cx/gpt-5.6-terra",
  ]);
  assert.equal(result.model, "cx/gpt-5.6-terra");
  assert.equal(result.taskType, "fallback");
  assert.equal(result.usedFallbackModel, true);
});
