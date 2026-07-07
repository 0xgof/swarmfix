import type { UwbMeasurement } from "../data/sceneTypes";
import type { Position3D } from "../animation/liveMotion";

export interface CandidateUwbLink {
  key: string;
  sourceId: string;
  targetId: string;
  distanceM: number;
  sigmaM: number;
  qualityScore: number;
  previousSelected: boolean;
}

export interface SelectedLiveUwbLink {
  sourceId: string;
  targetId: string;
  measuredDistanceM: number;
  sigmaM: number;
  selectionReason: "retained" | "new";
}

export interface LiveUwbSelectionOptions {
  maxLinksPerAgent: number;
  maxRangeM: number;
  addRangeM: number;
  dropRangeM: number;
  preferNearby: boolean;
  preferUnderconnectedAgents: boolean;
  preferTriangleClosure: boolean;
  maxGraphChangesPerFrame: number;
  minLinkSeparationDeg?: number;
}

const DEFAULT_MIN_LINK_SEPARATION_DEG = 10;

export interface LiveUwbSelectionDiagnostics {
  candidateLinkCount: number;
  selectedLinkCount: number;
  maxLinksPerAgent: number;
  connectedComponentCount: number;
  isolatedAgentCount: number;
  triangleCount: number;
  addedLinks: number;
  droppedLinks: number;
  selectionPolicy: "adaptive_range_graph_v1";
  adaptiveSelectionEnabled: true;
}

export interface LiveUwbSelectionInput {
  positions: Map<string, Position3D>;
  measurements: UwbMeasurement[];
  options: LiveUwbSelectionOptions;
  previousSelectedLinks?: SelectedLiveUwbLink[];
}

export interface LiveUwbSelection {
  candidates: CandidateUwbLink[];
  selectedLinks: SelectedLiveUwbLink[];
  diagnostics: LiveUwbSelectionDiagnostics;
}

export function stableUwbEndpointKey(link: {
  sourceId?: string;
  targetId?: string;
  source_id?: string;
  target_id?: string;
}): string {
  const sourceId = link.sourceId ?? link.source_id ?? "";
  const targetId = link.targetId ?? link.target_id ?? "";
  const endpoints = [sourceId, targetId].sort();
  const endpointKey = `${endpoints[0]}::${endpoints[1]}`;
  return endpointKey;
}

function distance3D(a: Position3D,
                    b: Position3D): number {
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return distance;
}

function safeOptions(options: LiveUwbSelectionOptions): LiveUwbSelectionOptions {
  const maxRangeM = Math.max(0, options.maxRangeM);
  const addRangeM = Math.max(0, Math.min(options.addRangeM, options.dropRangeM));
  const boundedOptions = {
    ...options,
    maxLinksPerAgent: Math.max(0, Math.floor(options.maxLinksPerAgent)),
    maxRangeM,
    addRangeM,
    dropRangeM: Math.max(maxRangeM, options.dropRangeM),
    maxGraphChangesPerFrame: Math.max(0, Math.floor(options.maxGraphChangesPerFrame))
  };
  return boundedOptions;
}

function buildCandidates(input: LiveUwbSelectionInput,
                         previousKeys: Set<string>,
                         options: LiveUwbSelectionOptions): CandidateUwbLink[] {
  const candidates: CandidateUwbLink[] = [];
  const candidateByKey = new Map<string, CandidateUwbLink>();
  for (const measurement of input.measurements) {
    const sourcePosition = input.positions.get(measurement.source_id);
    const targetPosition = input.positions.get(measurement.target_id);
    if (!sourcePosition || !targetPosition) {
      continue;
    }

    const key = stableUwbEndpointKey(measurement);
    const distanceM = distance3D(sourcePosition, targetPosition);
    if (distanceM > options.maxRangeM && !previousKeys.has(key)) {
      continue;
    }

    const candidate = {
      key,
      sourceId: measurement.source_id,
      targetId: measurement.target_id,
      distanceM,
      sigmaM: measurement.sigma_m,
      qualityScore: 1 / (1 + distanceM),
      previousSelected: previousKeys.has(key)
    };
    const existingCandidate = candidateByKey.get(key);
    if (!existingCandidate || candidate.distanceM < existingCandidate.distanceM) {
      candidateByKey.set(key, candidate);
    }
  }

  candidates.push(...candidateByKey.values());
  const sortedCandidates = candidates.sort((firstCandidate, secondCandidate) => (
    firstCandidate.distanceM - secondCandidate.distanceM
    || firstCandidate.key.localeCompare(secondCandidate.key)
  ));
  return sortedCandidates;
}

function selectedFromCandidate(candidate: CandidateUwbLink,
                               selectionReason: SelectedLiveUwbLink["selectionReason"]): SelectedLiveUwbLink {
  const selectedLink = {
    sourceId: candidate.sourceId,
    targetId: candidate.targetId,
    measuredDistanceM: candidate.distanceM,
    sigmaM: candidate.sigmaM,
    selectionReason
  };
  return selectedLink;
}

function canAddCandidate(candidate: CandidateUwbLink,
                         degreeByAgent: Map<string, number>,
                         options: LiveUwbSelectionOptions): boolean {
  const sourceDegree = degreeByAgent.get(candidate.sourceId) ?? 0;
  const targetDegree = degreeByAgent.get(candidate.targetId) ?? 0;
  const canAdd = (
    sourceDegree < options.maxLinksPerAgent
    && targetDegree < options.maxLinksPerAgent
  );
  return canAdd;
}

function addSelectedLink(candidate: CandidateUwbLink,
                         selectionReason: SelectedLiveUwbLink["selectionReason"],
                         selectedLinks: SelectedLiveUwbLink[],
                         selectedKeys: Set<string>,
                         degreeByAgent: Map<string, number>): void {
  selectedLinks.push(selectedFromCandidate(candidate, selectionReason));
  selectedKeys.add(candidate.key);
  degreeByAgent.set(candidate.sourceId, (degreeByAgent.get(candidate.sourceId) ?? 0) + 1);
  degreeByAgent.set(candidate.targetId, (degreeByAgent.get(candidate.targetId) ?? 0) + 1);
}

function angleAtVertex(vertex: Position3D,
                       first: Position3D,
                       second: Position3D): number {
  const toFirst = [first[0] - vertex[0], first[1] - vertex[1], first[2] - vertex[2]];
  const toSecond = [second[0] - vertex[0], second[1] - vertex[1], second[2] - vertex[2]];
  const firstLength = Math.max(Math.hypot(toFirst[0], toFirst[1], toFirst[2]), 1e-9);
  const secondLength = Math.max(Math.hypot(toSecond[0], toSecond[1], toSecond[2]), 1e-9);
  const cosine = (
    toFirst[0] * toSecond[0] + toFirst[1] * toSecond[1] + toFirst[2] * toSecond[2]
  ) / (firstLength * secondLength);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
  return angle;
}

function sharedEndpoint(candidate: CandidateUwbLink,
                        selectedKey: string): { shared: string;
                                                candidateOther: string;
                                                selectedOther: string } | null {
  const [firstAgent, secondAgent] = selectedKey.split("::");
  const candidateAgents = [candidate.sourceId, candidate.targetId];
  const selectedAgents = [firstAgent, secondAgent];
  const sharedAgents = candidateAgents.filter((agent) => selectedAgents.includes(agent));
  if (sharedAgents.length !== 1) {
    return null;
  }

  const shared = sharedAgents[0];
  const endpoints = {
    shared,
    candidateOther: candidate.sourceId === shared ? candidate.targetId : candidate.sourceId,
    selectedOther: firstAgent === shared ? secondAgent : firstAgent
  };
  return endpoints;
}

function nestsAlongSelectedLink(candidate: CandidateUwbLink,
                                selectedKeys: Set<string>,
                                positions: Map<string, Position3D>,
                                minAngleRad: number): boolean {
  for (const selectedKey of selectedKeys) {
    const endpoints = sharedEndpoint(candidate, selectedKey);
    if (!endpoints) {
      continue;
    }

    const sharedPosition = positions.get(endpoints.shared);
    const candidateOtherPosition = positions.get(endpoints.candidateOther);
    const selectedOtherPosition = positions.get(endpoints.selectedOther);
    if (!sharedPosition || !candidateOtherPosition || !selectedOtherPosition) {
      continue;
    }

    const separation = angleAtVertex(
      sharedPosition,
      candidateOtherPosition,
      selectedOtherPosition
    );
    if (separation < minAngleRad) {
      return true;
    }
  }

  return false;
}

function closesTriangle(candidate: CandidateUwbLink,
                        selectedKeys: Set<string>): boolean {
  const sourceNeighbors = new Set<string>();
  const targetNeighbors = new Set<string>();
  for (const key of selectedKeys) {
    const [firstAgent, secondAgent] = key.split("::");
    if (firstAgent === candidate.sourceId) {
      sourceNeighbors.add(secondAgent);
    }
    if (secondAgent === candidate.sourceId) {
      sourceNeighbors.add(firstAgent);
    }
    if (firstAgent === candidate.targetId) {
      targetNeighbors.add(secondAgent);
    }
    if (secondAgent === candidate.targetId) {
      targetNeighbors.add(firstAgent);
    }
  }

  const closesLoop = [...sourceNeighbors].some((neighbor) => targetNeighbors.has(neighbor));
  return closesLoop;
}

function sortAddCandidates(candidates: CandidateUwbLink[],
                           selectedKeys: Set<string>,
                           degreeByAgent: Map<string, number>,
                           options: LiveUwbSelectionOptions): CandidateUwbLink[] {
  const sortedCandidates = [...candidates].sort((firstCandidate, secondCandidate) => {
    const firstDegree = (
      (degreeByAgent.get(firstCandidate.sourceId) ?? 0)
      + (degreeByAgent.get(firstCandidate.targetId) ?? 0)
    );
    const secondDegree = (
      (degreeByAgent.get(secondCandidate.sourceId) ?? 0)
      + (degreeByAgent.get(secondCandidate.targetId) ?? 0)
    );
    const firstTriangle = options.preferTriangleClosure && closesTriangle(firstCandidate, selectedKeys)
      ? 1
      : 0;
    const secondTriangle = options.preferTriangleClosure && closesTriangle(secondCandidate, selectedKeys)
      ? 1
      : 0;
    const coverageRank = options.preferUnderconnectedAgents
      ? firstDegree - secondDegree
      : 0;
    const triangleRank = secondTriangle - firstTriangle;
    const distanceRank = options.preferNearby
      ? firstCandidate.distanceM - secondCandidate.distanceM
      : 0;
    const rank = (
      coverageRank
      || triangleRank
      || distanceRank
      || firstCandidate.key.localeCompare(secondCandidate.key)
    );
    return rank;
  });
  return sortedCandidates;
}

function triangleCount(selectedLinks: SelectedLiveUwbLink[]): number {
  const keys = new Set(selectedLinks.map(stableUwbEndpointKey));
  const agents = [...new Set(selectedLinks.flatMap((link) => [link.sourceId, link.targetId]))].sort();
  let count = 0;
  for (let firstIndex = 0; firstIndex < agents.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < agents.length; secondIndex += 1) {
      for (let thirdIndex = secondIndex + 1; thirdIndex < agents.length; thirdIndex += 1) {
        const firstAgent = agents[firstIndex];
        const secondAgent = agents[secondIndex];
        const thirdAgent = agents[thirdIndex];
        if (
          keys.has(stableUwbEndpointKey({ sourceId: firstAgent, targetId: secondAgent }))
          && keys.has(stableUwbEndpointKey({ sourceId: firstAgent, targetId: thirdAgent }))
          && keys.has(stableUwbEndpointKey({ sourceId: secondAgent, targetId: thirdAgent }))
        ) {
          count += 1;
        }
      }
    }
  }
  return count;
}

function graphDiagnostics(positions: Map<string, Position3D>,
                          selectedLinks: SelectedLiveUwbLink[]): {
  connectedComponentCount: number;
  isolatedAgentCount: number;
} {
  const agents = [...positions.keys()];
  const parent = new Map<string, string>();
  for (const agent of agents) {
    parent.set(agent, agent);
  }

  const findParent = (agent: string): string => {
    const currentParent = parent.get(agent) ?? agent;
    if (currentParent === agent) {
      return currentParent;
    }
    const rootParent = findParent(currentParent);
    parent.set(agent, rootParent);
    return rootParent;
  };
  const mergeAgents = (firstAgent: string, secondAgent: string): void => {
    const firstParent = findParent(firstAgent);
    const secondParent = findParent(secondAgent);
    if (firstParent !== secondParent) {
      parent.set(secondParent, firstParent);
    }
  };

  const degreeByAgent = new Map<string, number>();
  for (const link of selectedLinks) {
    mergeAgents(link.sourceId, link.targetId);
    degreeByAgent.set(link.sourceId, (degreeByAgent.get(link.sourceId) ?? 0) + 1);
    degreeByAgent.set(link.targetId, (degreeByAgent.get(link.targetId) ?? 0) + 1);
  }

  const connectedComponentCount = new Set(agents.map(findParent)).size;
  const isolatedAgentCount = agents.filter((agent) => (degreeByAgent.get(agent) ?? 0) === 0).length;
  const diagnostics = { connectedComponentCount, isolatedAgentCount };
  return diagnostics;
}

export function selectLiveUwbLinks(input: LiveUwbSelectionInput): LiveUwbSelection {
  const options = safeOptions(input.options);
  const previousKeys = new Set(
    (input.previousSelectedLinks ?? []).map(stableUwbEndpointKey)
  );
  const candidates = buildCandidates(input, previousKeys, options);
  const selectedLinks: SelectedLiveUwbLink[] = [];
  const selectedKeys = new Set<string>();
  const degreeByAgent = new Map<string, number>();

  const minAngleRad = (
    (options.minLinkSeparationDeg ?? DEFAULT_MIN_LINK_SEPARATION_DEG) * Math.PI / 180
  );
  if (options.maxLinksPerAgent > 0) {
    for (const candidate of candidates.filter((item) => item.previousSelected)) {
      if (candidate.distanceM <= options.dropRangeM
          && !selectedKeys.has(candidate.key)
          && canAddCandidate(candidate, degreeByAgent, options)
          && !nestsAlongSelectedLink(candidate, selectedKeys, input.positions, minAngleRad)) {
        addSelectedLink(candidate, "retained", selectedLinks, selectedKeys, degreeByAgent);
      }
    }

    const addBudget = previousKeys.size === 0
      ? Number.POSITIVE_INFINITY
      : options.maxGraphChangesPerFrame;
    let addedLinks = 0;
    while (addedLinks < addBudget) {
      const addCandidates = sortAddCandidates(
        candidates.filter((candidate) => (
          !selectedKeys.has(candidate.key)
          && candidate.distanceM <= options.addRangeM
          && canAddCandidate(candidate, degreeByAgent, options)
          && !nestsAlongSelectedLink(candidate, selectedKeys, input.positions, minAngleRad)
        )),
        selectedKeys,
        degreeByAgent,
        options
      );
      if (addCandidates.length === 0) {
        break;
      }

      addSelectedLink(addCandidates[0], "new", selectedLinks, selectedKeys, degreeByAgent);
      addedLinks += 1;
    }
  }

  const sortedSelectedLinks = selectedLinks.sort((firstLink, secondLink) => (
    stableUwbEndpointKey(firstLink).localeCompare(stableUwbEndpointKey(secondLink))
  ));
  const previousRetainedCount = sortedSelectedLinks.filter((link) => (
    previousKeys.has(stableUwbEndpointKey(link))
  )).length;
  const addedLinks = sortedSelectedLinks.filter((link) => (
    !previousKeys.has(stableUwbEndpointKey(link))
  )).length;
  const droppedLinks = [...previousKeys].filter((key) => !selectedKeys.has(key)).length;
  const graph = graphDiagnostics(input.positions, sortedSelectedLinks);
  const diagnostics = {
    candidateLinkCount: candidates.length,
    selectedLinkCount: sortedSelectedLinks.length,
    maxLinksPerAgent: options.maxLinksPerAgent,
    connectedComponentCount: graph.connectedComponentCount,
    isolatedAgentCount: graph.isolatedAgentCount,
    triangleCount: triangleCount(sortedSelectedLinks),
    addedLinks: previousKeys.size === 0 ? sortedSelectedLinks.length : addedLinks,
    droppedLinks,
    selectionPolicy: "adaptive_range_graph_v1" as const,
    adaptiveSelectionEnabled: true as const
  };
  void previousRetainedCount;
  const selection = {
    candidates,
    selectedLinks: sortedSelectedLinks,
    diagnostics
  };
  return selection;
}
