"""Positions-only HTTP API helpers for backend-owned mission actions."""

from __future__ import annotations

from swarmfix.live.models import (
    MissionActionCatalogResponse,
    MissionActionPosition,
    MissionActionPositionsMetadata,
    MissionActionPositionsRequest,
    MissionActionPositionsResponse,
)
from swarmfix.scenarios.mission_actions import (
    mission_action_catalog,
    mission_action_positions,
)


def build_catalog_response() -> MissionActionCatalogResponse:
    """Return the supported mission-action metadata for viewer controls."""
    catalog = mission_action_catalog()
    catalog_response = MissionActionCatalogResponse(
        formations=catalog.formations,
        motions=catalog.motions,
    )
    return catalog_response


def build_positions_response(request: MissionActionPositionsRequest) -> MissionActionPositionsResponse:
    """Generate mission positions without producing sensors or solver frames."""
    positions_by_agent = mission_action_positions(
        request.agent_ids,
        request.mission_action,
        request.time_s,
    )
    positions = [
        MissionActionPosition(
            agent_id=agent_id,
            position_m=positions_by_agent[agent_id],
        )
        for agent_id in request.agent_ids
    ]
    metadata = MissionActionPositionsMetadata(
        formation=request.mission_action.formation,
        motion=request.mission_action.motion,
        time_s=request.time_s,
    )
    positions_response = MissionActionPositionsResponse(
        metadata=metadata,
        positions=positions,
    )
    return positions_response
