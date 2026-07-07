import type { UwbMeasurement } from "../data/sceneTypes";

export type Position3D = [number, number, number];

function stablePhase(agentId: string): number {
  let hash = 0;
  for (const char of agentId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }

  const phase = hash / 100000 * Math.PI * 2;
  return phase;
}

function stableUnit(agentId: string,
                    salt: number): number {
  let hash = salt;
  for (const char of agentId) {
    hash = (hash * 37 + char.charCodeAt(0) + salt) % 100000;
  }

  const unitValue = hash / 100000;
  return unitValue;
}

function agentIndex(agentId: string): number {
  const match = agentId.match(/(\d+)$/);
  if (!match) {
    return 0;
  }

  const index = Number(match[1]);
  return index;
}

export function liftPositionTo3D(position: number[]): Position3D {
  const liftedPosition: Position3D = [
    position[0] ?? 0,
    position[2] ?? 0,
    position[1] ?? 0
  ];
  return liftedPosition;
}

export function animatedSwarmPosition(agentId: string,
                                      nominalPosition: Position3D,
                                      timeSeconds: number,
                                      jitterRadius: number): Position3D {
  const phase = stablePhase(agentId);
  const index = agentIndex(agentId);
  const decorrelatedPhase = phase + index * 1.37;
  const xFrequency = 0.55 + stableUnit(agentId, 11) * 0.45 + index * 0.035;
  const yFrequency = 0.85 + stableUnit(agentId, 23) * 0.55 + index * 0.027;
  const zFrequency = 0.48 + stableUnit(agentId, 41) * 0.5 + index * 0.031;
  const xAmplitude = jitterRadius * (0.55 + stableUnit(agentId, 53) * 0.45);
  const zAmplitude = jitterRadius * (0.55 + stableUnit(agentId, 67) * 0.45);
  const x = nominalPosition[0]
    + Math.sin(timeSeconds * xFrequency + decorrelatedPhase) * xAmplitude;
  const y = nominalPosition[1]
    + Math.sin(timeSeconds * yFrequency + decorrelatedPhase * 0.7) * jitterRadius * 0.32;
  const z = nominalPosition[2]
    + Math.cos(timeSeconds * zFrequency + decorrelatedPhase * 1.3) * zAmplitude;
  const animatedPosition: Position3D = [x, y, z];
  return animatedPosition;
}

export function animatedGaussianScale(agentId: string,
                                      sigmaM: number,
                                      timeSeconds: number): number {
  const phase = stablePhase(agentId);
  const pulse = 1 + Math.sin(timeSeconds * 1.6 + phase) * 0.14;
  const scale = Math.max(0, sigmaM) * pulse;
  return scale;
}

export function selectUwbLinks(links: UwbMeasurement[],
                               linkCount: number): UwbMeasurement[] {
  const safeLinkCount = Math.max(0, Math.floor(linkCount));
  const selectedLinks = links.slice(0, safeLinkCount);
  return selectedLinks;
}

function stableUwbLinkKey(link: UwbMeasurement): string {
  const endpoints = [link.source_id, link.target_id].sort();
  const linkKey = `${endpoints[0]}::${endpoints[1]}::${link.measured_distance_m}`;
  return linkKey;
}

export function selectUwbLinksByMaxDegree(links: UwbMeasurement[],
                                          maxLinksPerAgent: number): UwbMeasurement[] {
  const safeMaxLinks = Math.max(0, Math.floor(maxLinksPerAgent));
  if (safeMaxLinks === 0) {
    return [];
  }

  const selectedLinks: UwbMeasurement[] = [];
  const degreeByAgent = new Map<string, number>();
  const sortedLinks = [...links].sort((firstLink, secondLink) => (
    stableUwbLinkKey(firstLink).localeCompare(stableUwbLinkKey(secondLink))
  ));

  for (const link of sortedLinks) {
    const sourceDegree = degreeByAgent.get(link.source_id) ?? 0;
    const targetDegree = degreeByAgent.get(link.target_id) ?? 0;
    if (sourceDegree >= safeMaxLinks || targetDegree >= safeMaxLinks) {
      continue;
    }

    selectedLinks.push(link);
    degreeByAgent.set(link.source_id, sourceDegree + 1);
    degreeByAgent.set(link.target_id, targetDegree + 1);
  }

  return selectedLinks;
}
