export type RuntimeEnvironment = Record<string, string | undefined>;

export function readRuntimeEnv(): RuntimeEnvironment {
  if (typeof process === "undefined" || !process.env) {
    return {};
  }

  return process.env as RuntimeEnvironment;
}
