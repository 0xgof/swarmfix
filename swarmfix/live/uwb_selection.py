"""Backend-canonical adaptive live UWB link selection.

Workflow position: this module sits between the live sensor snapshot
(``swarmfix.live.sensor_snapshot``) and live solving. It decides which UWB
candidate ranges become distance constraints for the solver, replacing
``viewer/src/simulation/uwbLinkSelection.ts`` as the normal-path selector.

This is a behavior-preserving port (BLF-003). Policy characteristics:

- stable undirected endpoint keys and deterministic ordering;
- per-agent degree cap with unbounded default range;
- retention of previous links up to the drop range, new links only within
  the add range, and a graph-change budget per frame (unlimited on the
  initial fill);
- ranking that prefers underconnected agents, then triangle closure, then
  nearby links;
- a nested/collinear angle gate that rejects candidates whose angular
  separation from an already selected link at a shared endpoint is below
  ``min_link_separation_deg`` (default 10 degrees).

Ordering note: the TypeScript selector breaks ties with locale-dependent
``localeCompare``; this port uses plain codepoint comparison. Parity for
realistic agent ids is proven by the committed fixture file
``tests/fixtures/uwb_selection_parity.json``.

Selection here is pure and deterministic. Observability for selection
outcomes is emitted by the orchestrating endpoint boundary, not here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence, Union

from swarmfix.live.models import (
    LiveSelectedUwbLink,
    LiveUwbMeasurement,
    LiveUwbSelectionDiagnostics,
    SelectedUwbLink,
)

DEFAULT_MIN_LINK_SEPARATION_DEG = 10.0

Position3D = tuple[float, float, float]
PreviousLink = Union[SelectedUwbLink, LiveSelectedUwbLink]


@dataclass(frozen=True)
class LiveUwbSelectionOptions:
    """Selection policy knobs mirroring the viewer's adaptive selector.

    ``add_range_m`` and ``drop_range_m`` default to the viewer call-site
    behavior when unset: add range equals max range and drop range is 1.1
    times max range.
    """

    max_links_per_agent: int
    max_range_m: float = math.inf
    add_range_m: float | None = None
    drop_range_m: float | None = None
    prefer_nearby: bool = True
    prefer_underconnected_agents: bool = True
    prefer_triangle_closure: bool = True
    max_graph_changes_per_frame: int = 2
    min_link_separation_deg: float = DEFAULT_MIN_LINK_SEPARATION_DEG


@dataclass(frozen=True)
class _ResolvedOptions:
    """Options after defaulting and safety clamping."""

    max_links_per_agent: int
    max_range_m: float
    add_range_m: float
    drop_range_m: float
    prefer_nearby: bool
    prefer_underconnected_agents: bool
    prefer_triangle_closure: bool
    max_graph_changes_per_frame: int
    min_angle_rad: float


@dataclass(frozen=True)
class CandidateUwbLink:
    """One deduplicated candidate link with its live geometric distance."""

    key: str
    source_id: str
    target_id: str
    distance_m: float
    sigma_m: float
    quality_score: float
    previous_selected: bool


@dataclass(frozen=True)
class LiveUwbSelection:
    """Result of one selection pass: candidates, links, and diagnostics."""

    candidates: tuple[CandidateUwbLink, ...]
    selected_links: tuple[LiveSelectedUwbLink, ...]
    diagnostics: LiveUwbSelectionDiagnostics


def stable_uwb_endpoint_key(source_id: str,
                            target_id: str) -> str:
    """Return the undirected endpoint key shared across live modules."""
    first_id, second_id = sorted((source_id, target_id))
    endpoint_key = f"{first_id}::{second_id}"
    return endpoint_key


def _distance_3d(a: Position3D,
                 b: Position3D) -> float:
    """Return the Euclidean distance between two positions."""
    distance_m = math.sqrt(
        (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
    )
    return distance_m


def _resolve_options(options: LiveUwbSelectionOptions) -> _ResolvedOptions:
    """Apply call-site defaults and the safety clamps of the viewer port."""
    max_range_m = max(0.0, options.max_range_m)
    raw_add_range_m = (
        options.add_range_m if options.add_range_m is not None else max_range_m
    )
    raw_drop_range_m = (
        options.drop_range_m
        if options.drop_range_m is not None
        else max_range_m * 1.1
    )
    add_range_m = max(0.0, min(raw_add_range_m, raw_drop_range_m))
    drop_range_m = max(max_range_m, raw_drop_range_m)
    min_angle_rad = options.min_link_separation_deg * math.pi / 180.0
    resolved = _ResolvedOptions(
        max_links_per_agent=max(0, math.floor(options.max_links_per_agent)),
        max_range_m=max_range_m,
        add_range_m=add_range_m,
        drop_range_m=drop_range_m,
        prefer_nearby=options.prefer_nearby,
        prefer_underconnected_agents=options.prefer_underconnected_agents,
        prefer_triangle_closure=options.prefer_triangle_closure,
        max_graph_changes_per_frame=max(0, math.floor(options.max_graph_changes_per_frame)),
        min_angle_rad=min_angle_rad,
    )
    return resolved


def _build_candidates(positions: dict[str, Position3D],
                      measurements: Sequence[LiveUwbMeasurement],
                      previous_keys: set[str],
                      options: _ResolvedOptions) -> list[CandidateUwbLink]:
    """Deduplicate measurements into range-filtered, sorted candidates."""
    candidate_by_key: dict[str, CandidateUwbLink] = {}
    for measurement in measurements:
        source_position = positions.get(measurement.source_id)
        target_position = positions.get(measurement.target_id)
        if source_position is None or target_position is None:
            continue

        key = stable_uwb_endpoint_key(measurement.source_id, measurement.target_id)
        distance_m = _distance_3d(source_position, target_position)
        if distance_m > options.max_range_m and key not in previous_keys:
            continue

        candidate = CandidateUwbLink(
            key=key,
            source_id=measurement.source_id,
            target_id=measurement.target_id,
            distance_m=distance_m,
            sigma_m=measurement.sigma_m,
            quality_score=1.0 / (1.0 + distance_m),
            previous_selected=key in previous_keys,
        )
        existing = candidate_by_key.get(key)
        if existing is None or candidate.distance_m < existing.distance_m:
            candidate_by_key[key] = candidate

    sorted_candidates = sorted(
        candidate_by_key.values(),
        key=lambda candidate: (candidate.distance_m, candidate.key),
    )
    return sorted_candidates


def _can_add_candidate(candidate: CandidateUwbLink,
                       degree_by_agent: dict[str, int],
                       options: _ResolvedOptions) -> bool:
    """Check the per-agent degree cap for both endpoints."""
    source_degree = degree_by_agent.get(candidate.source_id, 0)
    target_degree = degree_by_agent.get(candidate.target_id, 0)
    can_add = (
        source_degree < options.max_links_per_agent
        and target_degree < options.max_links_per_agent
    )
    return can_add


def _angle_at_vertex(vertex: Position3D,
                     first: Position3D,
                     second: Position3D) -> float:
    """Return the angle at a shared vertex between two link directions."""
    to_first = (first[0] - vertex[0], first[1] - vertex[1], first[2] - vertex[2])
    to_second = (second[0] - vertex[0], second[1] - vertex[1], second[2] - vertex[2])
    first_length = max(math.sqrt(sum(axis ** 2 for axis in to_first)), 1e-9)
    second_length = max(math.sqrt(sum(axis ** 2 for axis in to_second)), 1e-9)
    cosine = (
        to_first[0] * to_second[0]
        + to_first[1] * to_second[1]
        + to_first[2] * to_second[2]
    ) / (first_length * second_length)
    angle = math.acos(max(-1.0, min(1.0, cosine)))
    return angle


def _shared_endpoint(candidate: CandidateUwbLink,
                     selected_key: str) -> tuple[str, str, str] | None:
    """Return (shared, candidate_other, selected_other) when the candidate
    shares exactly one endpoint with a selected link, else None."""
    first_agent, second_agent = selected_key.split("::")
    selected_agents = (first_agent, second_agent)
    shared_agents = [
        agent
        for agent in (candidate.source_id, candidate.target_id)
        if agent in selected_agents
    ]
    if len(shared_agents) != 1:
        return None

    shared = shared_agents[0]
    candidate_other = (
        candidate.target_id if candidate.source_id == shared else candidate.source_id
    )
    selected_other = second_agent if first_agent == shared else first_agent
    endpoints = (shared, candidate_other, selected_other)
    return endpoints


def _nests_along_selected_link(candidate: CandidateUwbLink,
                               selected_keys: set[str],
                               positions: dict[str, Position3D],
                               min_angle_rad: float) -> bool:
    """Reject candidates angularly nested along an already selected link."""
    for selected_key in selected_keys:
        endpoints = _shared_endpoint(candidate, selected_key)
        if endpoints is None:
            continue

        shared, candidate_other, selected_other = endpoints
        shared_position = positions.get(shared)
        candidate_other_position = positions.get(candidate_other)
        selected_other_position = positions.get(selected_other)
        if (
            shared_position is None
            or candidate_other_position is None
            or selected_other_position is None
        ):
            continue

        separation = _angle_at_vertex(
            shared_position,
            candidate_other_position,
            selected_other_position,
        )
        if separation < min_angle_rad:
            return True

    return False


def _closes_triangle(candidate: CandidateUwbLink,
                     selected_keys: set[str]) -> bool:
    """Check whether the candidate closes a loop with two selected links."""
    source_neighbors: set[str] = set()
    target_neighbors: set[str] = set()
    for key in selected_keys:
        first_agent, second_agent = key.split("::")
        if first_agent == candidate.source_id:
            source_neighbors.add(second_agent)
        if second_agent == candidate.source_id:
            source_neighbors.add(first_agent)
        if first_agent == candidate.target_id:
            target_neighbors.add(second_agent)
        if second_agent == candidate.target_id:
            target_neighbors.add(first_agent)

    closes_loop = bool(source_neighbors & target_neighbors)
    return closes_loop


def _add_rank_key(candidate: CandidateUwbLink,
                  selected_keys: set[str],
                  degree_by_agent: dict[str, int],
                  options: _ResolvedOptions) -> tuple[int, int, float, str]:
    """Ranking tuple mirroring coverage, triangle, distance, key ordering."""
    degree_sum = (
        degree_by_agent.get(candidate.source_id, 0)
        + degree_by_agent.get(candidate.target_id, 0)
    )
    coverage_rank = degree_sum if options.prefer_underconnected_agents else 0
    triangle_rank = (
        -1
        if options.prefer_triangle_closure and _closes_triangle(candidate, selected_keys)
        else 0
    )
    distance_rank = candidate.distance_m if options.prefer_nearby else 0.0
    rank_key = (coverage_rank, triangle_rank, distance_rank, candidate.key)
    return rank_key


def _selected_from_candidate(candidate: CandidateUwbLink,
                             selection_reason: str) -> LiveSelectedUwbLink:
    """Convert a candidate into a selected-link record."""
    selected_link = LiveSelectedUwbLink(
        source_id=candidate.source_id,
        target_id=candidate.target_id,
        measured_distance_m=candidate.distance_m,
        sigma_m=candidate.sigma_m,
        selection_reason=selection_reason,
    )
    return selected_link


@dataclass
class _SelectionState:
    """Mutable working state for one selection pass."""

    selected_links: list[LiveSelectedUwbLink] = field(default_factory=list)
    selected_keys: set[str] = field(default_factory=set)
    degree_by_agent: dict[str, int] = field(default_factory=dict)

    def add(self,
            candidate: CandidateUwbLink,
            selection_reason: str) -> None:
        """Record one selected link and update degree bookkeeping."""
        self.selected_links.append(_selected_from_candidate(candidate, selection_reason))
        self.selected_keys.add(candidate.key)
        self.degree_by_agent[candidate.source_id] = (
            self.degree_by_agent.get(candidate.source_id, 0) + 1
        )
        self.degree_by_agent[candidate.target_id] = (
            self.degree_by_agent.get(candidate.target_id, 0) + 1
        )


def _graph_diagnostics(positions: dict[str, Position3D],
                       selected_links: Sequence[LiveSelectedUwbLink]) -> tuple[int, int]:
    """Return (connected component count, isolated agent count)."""
    parent = {agent: agent for agent in positions}

    def find_parent(agent: str) -> str:
        root = agent
        while parent.get(root, root) != root:
            root = parent[root]
        while parent.get(agent, agent) != root:
            parent[agent], agent = root, parent[agent]
        return root

    degree_by_agent: dict[str, int] = {}
    for link in selected_links:
        source_root = find_parent(link.source_id)
        target_root = find_parent(link.target_id)
        if source_root != target_root:
            parent[target_root] = source_root
        degree_by_agent[link.source_id] = degree_by_agent.get(link.source_id, 0) + 1
        degree_by_agent[link.target_id] = degree_by_agent.get(link.target_id, 0) + 1

    connected_component_count = len({find_parent(agent) for agent in positions})
    isolated_agent_count = sum(
        1 for agent in positions if degree_by_agent.get(agent, 0) == 0
    )
    return connected_component_count, isolated_agent_count


def _triangle_count(selected_links: Sequence[LiveSelectedUwbLink]) -> int:
    """Count closed three-agent loops in the selected graph."""
    keys = {
        stable_uwb_endpoint_key(link.source_id, link.target_id)
        for link in selected_links
    }
    agents = sorted(
        {agent for link in selected_links for agent in (link.source_id, link.target_id)}
    )
    count = 0
    for first_index in range(len(agents)):
        for second_index in range(first_index + 1, len(agents)):
            for third_index in range(second_index + 1, len(agents)):
                first_agent = agents[first_index]
                second_agent = agents[second_index]
                third_agent = agents[third_index]
                if (
                    stable_uwb_endpoint_key(first_agent, second_agent) in keys
                    and stable_uwb_endpoint_key(first_agent, third_agent) in keys
                    and stable_uwb_endpoint_key(second_agent, third_agent) in keys
                ):
                    count += 1
    return count


def select_live_uwb_links(positions: dict[str, Position3D],
                          measurements: Sequence[LiveUwbMeasurement],
                          options: LiveUwbSelectionOptions,
                          previous_selected_links: Sequence[PreviousLink] = ()) -> LiveUwbSelection:
    """Select the UWB links that become live solver distance constraints.

    Mirrors the viewer selector: previously selected links are retained
    while inside the drop range and not angle-gated, then new links are
    added by rank within the add range, limited by the graph-change budget
    unless this is the initial fill.
    """
    resolved = _resolve_options(options)
    previous_keys = {
        stable_uwb_endpoint_key(link.source_id, link.target_id)
        for link in previous_selected_links
    }
    candidates = _build_candidates(positions, measurements, previous_keys, resolved)
    state = _SelectionState()

    if resolved.max_links_per_agent > 0:
        for candidate in candidates:
            if not candidate.previous_selected:
                continue
            if (
                candidate.distance_m <= resolved.drop_range_m
                and candidate.key not in state.selected_keys
                and _can_add_candidate(candidate, state.degree_by_agent, resolved)
                and not _nests_along_selected_link(
                    candidate,
                    state.selected_keys,
                    positions,
                    resolved.min_angle_rad,
                )
            ):
                state.add(candidate, "retained")

        add_budget = (
            math.inf if not previous_keys else resolved.max_graph_changes_per_frame
        )
        added_count = 0
        while added_count < add_budget:
            add_candidates = [
                candidate
                for candidate in candidates
                if (
                    candidate.key not in state.selected_keys
                    and candidate.distance_m <= resolved.add_range_m
                    and _can_add_candidate(candidate, state.degree_by_agent, resolved)
                    and not _nests_along_selected_link(
                        candidate,
                        state.selected_keys,
                        positions,
                        resolved.min_angle_rad,
                    )
                )
            ]
            if not add_candidates:
                break

            best_candidate = min(
                add_candidates,
                key=lambda candidate: _add_rank_key(
                    candidate,
                    state.selected_keys,
                    state.degree_by_agent,
                    resolved,
                ),
            )
            state.add(best_candidate, "new")
            added_count += 1

    sorted_selected_links = sorted(
        state.selected_links,
        key=lambda link: stable_uwb_endpoint_key(link.source_id, link.target_id),
    )
    added_links = sum(
        1
        for link in sorted_selected_links
        if stable_uwb_endpoint_key(link.source_id, link.target_id) not in previous_keys
    )
    dropped_links = sum(
        1 for key in previous_keys if key not in state.selected_keys
    )
    connected_component_count, isolated_agent_count = _graph_diagnostics(
        positions,
        sorted_selected_links,
    )
    diagnostics = LiveUwbSelectionDiagnostics(
        candidate_link_count=len(candidates),
        selected_link_count=len(sorted_selected_links),
        max_links_per_agent=resolved.max_links_per_agent,
        connected_component_count=connected_component_count,
        isolated_agent_count=isolated_agent_count,
        triangle_count=_triangle_count(sorted_selected_links),
        added_links=(
            len(sorted_selected_links) if not previous_keys else added_links
        ),
        dropped_links=dropped_links,
    )
    selection = LiveUwbSelection(
        candidates=tuple(candidates),
        selected_links=tuple(sorted_selected_links),
        diagnostics=diagnostics,
    )
    return selection
