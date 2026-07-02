import type { SceneTrace } from "./sceneTypes";
import { validateSceneTrace } from "./validateSceneTrace";

const SUPPORTED_SCHEMA_VERSION = "0.1.0";

export function loadSceneTraceFromObject(value: unknown): SceneTrace {
  const sceneTrace = validateSceneTrace(value);

  if (sceneTrace.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported scene trace schema_version: ${sceneTrace.schema_version}`
    );
  }

  return sceneTrace;
}

export async function loadSceneTrace(url: string): Promise<SceneTrace> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load scene trace: ${response.status}`);
  }

  const sceneTraceJson = await response.json();
  const sceneTrace = loadSceneTraceFromObject(sceneTraceJson);
  return sceneTrace;
}
