import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultMissionActionState } from "../simulation/missionActions";
import { requestMissionActionPositions } from "./missionActionPositionsClient";

describe("mission action positions client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts agent ids, time, and snake-case mission action state", async () => {
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
      requestBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          schema_version: "0.1.0",
          metadata: {
            formation: "grid",
            motion: "forward",
            time_s: 3
          },
          positions: [{
            agent_id: "agent_0",
            position_m: [1, 2, 3]
          }]
        })
      };
    }));

    const positions = await requestMissionActionPositions(
      ["agent_0"],
      {
        ...defaultMissionActionState(),
        motion: "forward",
        speedMps: 2,
        randomWalkAmplitudeM: 0.5
      },
      3,
      "http://backend/mission-actions/positions"
    );

    expect(requestBody).toEqual({
      agent_ids: ["agent_0"],
      time_s: 3,
      mission_action: {
        formation: "grid",
        motion: "forward",
        speed_mps: 2,
        random_walk_amplitude_m: 0.5,
        path: "loop",
        previous_formation: null,
        transition_started_at_s: null,
        transition_duration_s: 2
      }
    });
    expect(positions.get("agent_0")).toEqual([1, 2, 3]);
  });

  it("rejects responses that contain no mission positions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        schema_version: "0.1.0",
        metadata: {
          formation: "grid",
          motion: "static",
          time_s: 0
        }
      })
    })));

    await expect(requestMissionActionPositions(
      ["agent_0"],
      defaultMissionActionState(),
      0
    )).rejects.toThrow("missing positions");
  });
});
