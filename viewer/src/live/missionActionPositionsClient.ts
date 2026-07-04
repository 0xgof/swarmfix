import type { Position3D } from "../animation/liveMotion";
import {
  normalizeMissionActionState,
  type MissionActionState
} from "../simulation/missionActions";

export const defaultMissionActionPositionsEndpoint = (
  "http://127.0.0.1:8765/mission-actions/positions"
);

interface ApiMissionActionPosition {
  agent_id: string;
  position_m: number[];
}

interface ApiMissionActionPositionsResponse {
  positions?: ApiMissionActionPosition[];
}

function missionActionRequestBody(agentIds: string[],
                                  missionAction: MissionActionState,
                                  timeSeconds: number): Record<string, unknown> {
  const normalizedAction = normalizeMissionActionState(missionAction);
  const body = {
    agent_ids: agentIds,
    time_s: timeSeconds,
    mission_action: {
      formation: normalizedAction.formation,
      motion: normalizedAction.motion,
      speed_mps: normalizedAction.speedMps,
      random_walk_amplitude_m: normalizedAction.randomWalkAmplitudeM,
      path: normalizedAction.path,
      previous_formation: normalizedAction.previousFormation,
      transition_started_at_s: normalizedAction.transitionStartedAtS,
      transition_duration_s: normalizedAction.transitionDurationS
    }
  };
  return body;
}

function validatePositionsPayload(payload: unknown): ApiMissionActionPositionsResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("mission action positions response is not an object");
  }

  const positionsResponse = payload as ApiMissionActionPositionsResponse;
  if (!Array.isArray(positionsResponse.positions)) {
    throw new Error("mission action positions response is missing positions");
  }
  return positionsResponse;
}

function toPosition3D(positionM: number[]): Position3D {
  if (
    positionM.length < 3
    || !positionM.every((coordinate) => Number.isFinite(coordinate))
  ) {
    throw new Error("mission action position must be a finite 3D coordinate");
  }

  const position: Position3D = [positionM[0], positionM[1], positionM[2]];
  return position;
}

export async function requestMissionActionPositions(agentIds: string[],
                                                    missionAction: MissionActionState,
                                                    timeSeconds: number,
                                                    endpointUrl = defaultMissionActionPositionsEndpoint): Promise<Map<string, Position3D>> {
  const positionsResponse = await fetch(endpointUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(missionActionRequestBody(agentIds, missionAction, timeSeconds))
  });

  if (!positionsResponse.ok) {
    const errorText = await positionsResponse.text();
    throw new Error(
      `mission action positions request failed with ${positionsResponse.status}: ${errorText}`
    );
  }

  const payload = await positionsResponse.json();
  const positionsPayload = validatePositionsPayload(payload);
  const positions = new Map<string, Position3D>();
  for (const position of positionsPayload.positions ?? []) {
    positions.set(position.agent_id, toPosition3D(position.position_m));
  }

  return positions;
}
