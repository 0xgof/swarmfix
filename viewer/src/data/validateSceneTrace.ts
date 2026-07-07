import type { SceneTrace } from "./sceneTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (!isRecord(value)) {
    throw new Error(`Scene trace is missing required object: ${key}`);
  }
  return value;
}

export function validateSceneTrace(value: unknown): SceneTrace {
  if (!isRecord(value)) {
    throw new Error("Scene trace must be an object");
  }
  if (typeof value.schema_version !== "string") {
    throw new Error("Scene trace is missing schema_version");
  }

  requireRecord(value, "metadata");
  requireRecord(value, "truth");
  requireRecord(value, "measurements");
  requireRecord(value, "estimates");
  requireRecord(value, "metrics");
  requireRecord(value, "trace");

  const sceneTrace = value as unknown as SceneTrace;
  return sceneTrace;
}
