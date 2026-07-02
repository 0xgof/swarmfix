import type {
  LiveAgentState,
  LivePositionEstimate,
  LiveSolveResponse,
  LiveTraceIteration
} from "./liveSolveTypes";

function boundedProgress(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t;
}

function interpolatePosition(from: number[],
                             to: number[],
                             progress: number): number[] {
  const t = boundedProgress(progress);
  const dimension = Math.max(from.length, to.length);
  const position = [];
  for (let index = 0; index < dimension; index += 1) {
    const fromCoordinate = from[index] ?? to[index] ?? 0;
    const toCoordinate = to[index] ?? fromCoordinate;
    position.push(fromCoordinate + (toCoordinate - fromCoordinate) * t);
  }

  return position;
}

function interpolateAgentStates(from: LiveAgentState[],
                                to: LiveAgentState[],
                                progress: number): LiveAgentState[] {
  const fromByAgent = new Map(from.map((agent) => [agent.agent_id, agent]));
  const states = to.map((agent) => {
    const previousAgent = fromByAgent.get(agent.agent_id);
    if (!previousAgent) {
      return { ...agent, position_m: [...agent.position_m] };
    }

    const state = {
      ...agent,
      position_m: interpolatePosition(
        previousAgent.position_m,
        agent.position_m,
        progress
      )
    };
    return state;
  });
  return states;
}

function interpolateEstimates(from: LivePositionEstimate[],
                              to: LivePositionEstimate[],
                              progress: number): LivePositionEstimate[] {
  const fromByAgent = new Map(from.map((estimate) => [estimate.agent_id, estimate]));
  const estimates = to.map((estimate) => {
    const previousEstimate = fromByAgent.get(estimate.agent_id);
    if (!previousEstimate) {
      return { ...estimate, position_m: [...estimate.position_m] };
    }

    const interpolatedEstimate = {
      ...estimate,
      position_m: interpolatePosition(
        previousEstimate.position_m,
        estimate.position_m,
        progress
      )
    };
    return interpolatedEstimate;
  });
  return estimates;
}

function isPositionMeasurement(value: Record<string, unknown>): value is Record<string, unknown> & {
  agent_id: string;
  position_m: number[];
} {
  const hasPosition = (
    typeof value.agent_id === "string"
    && Array.isArray(value.position_m)
  );
  return hasPosition;
}

function interpolatePositionMeasurements(from: Record<string, unknown>[],
                                         to: Record<string, unknown>[],
                                         progress: number): Record<string, unknown>[] {
  const fromByAgent = new Map(
    from.filter(isPositionMeasurement).map((measurement) => [
      measurement.agent_id,
      measurement
    ])
  );
  const measurements = to.map((measurement) => {
    if (!isPositionMeasurement(measurement)) {
      return { ...measurement };
    }

    const previousMeasurement = fromByAgent.get(measurement.agent_id);
    if (!previousMeasurement) {
      return { ...measurement, position_m: [...measurement.position_m] };
    }

    const interpolatedMeasurement = {
      ...measurement,
      position_m: interpolatePosition(
        previousMeasurement.position_m,
        measurement.position_m,
        progress
      )
    };
    return interpolatedMeasurement;
  });
  return measurements;
}

function interpolateTracePositions(from: Record<string, number[]> | undefined,
                                   to: Record<string, number[]>,
                                   progress: number): Record<string, number[]> {
  const positions: Record<string, number[]> = {};
  for (const [agentId, position] of Object.entries(to)) {
    const previousPosition = from?.[agentId];
    positions[agentId] = previousPosition
      ? interpolatePosition(previousPosition, position, progress)
      : [...position];
  }

  return positions;
}

function interpolateTraceIterations(from: LiveTraceIteration[],
                                    to: LiveTraceIteration[],
                                    progress: number): LiveTraceIteration[] {
  const fromByIteration = new Map(from.map((iteration) => [
    iteration.iteration,
    iteration
  ]));
  const iterations = to.map((iteration) => {
    const previousIteration = fromByIteration.get(iteration.iteration);
    const interpolatedIteration = {
      ...iteration,
      positions: interpolateTracePositions(
        previousIteration?.positions,
        iteration.positions,
        progress
      ),
      gnss_residuals: iteration.gnss_residuals.map((residual) => ({ ...residual })),
      uwb_residuals: iteration.uwb_residuals.map((residual) => ({ ...residual }))
    };
    return interpolatedIteration;
  });
  return iterations;
}

export function interpolateLiveSolveResponse(from: LiveSolveResponse,
                                             to: LiveSolveResponse,
                                             progress: number): LiveSolveResponse {
  const response = {
    ...to,
    metadata: {
      ...to.metadata,
      trace_context: to.metadata.trace_context
        ? { ...to.metadata.trace_context }
        : to.metadata.trace_context
    },
    truth: interpolateAgentStates(from.truth, to.truth, progress),
    measurements: {
      gnss: interpolatePositionMeasurements(
        from.measurements.gnss,
        to.measurements.gnss,
        progress
      ),
      uwb: to.measurements.uwb.map((measurement) => ({ ...measurement }))
    },
    estimates: {
      fused: interpolateEstimates(from.estimates.fused, to.estimates.fused, progress),
      gnss_only: interpolateEstimates(
        from.estimates.gnss_only,
        to.estimates.gnss_only,
        progress
      )
    },
    trace: {
      ...to.trace,
      iterations: interpolateTraceIterations(
        from.trace.iterations,
        to.trace.iterations,
        progress
      )
    },
    constraints: {
      nodes: to.constraints.nodes.map((node) => ({ ...node })),
      edges: to.constraints.edges.map((edge) => ({ ...edge }))
    }
  };
  return response;
}
