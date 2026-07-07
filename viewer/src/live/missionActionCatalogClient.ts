import type {
  FormationMode,
  MotionMode
} from "../simulation/missionActions";

export const defaultMissionActionCatalogEndpoint = (
  "http://127.0.0.1:8765/mission-actions/catalog"
);

export type GeometryRisk = "low" | "medium" | "high";

export interface MissionActionCatalogOption<TId extends string = string> {
  id: TId;
  label: string;
  description: string;
  parameters: string[];
  geometryTraits: string[];
  solverGeometryRisk: GeometryRisk;
}

export interface MissionActionCatalog {
  formations: Array<MissionActionCatalogOption<FormationMode>>;
  motions: Array<MissionActionCatalogOption<MotionMode>>;
}

interface ApiMissionActionOption {
  id: string;
  label: string;
  description: string;
  parameters?: string[];
  geometry_traits?: string[];
  solver_geometry_risk?: GeometryRisk;
}

interface ApiMissionActionCatalog {
  formations?: ApiMissionActionOption[];
  motions?: ApiMissionActionOption[];
}

interface ValidatedApiMissionActionCatalog {
  formations: ApiMissionActionOption[];
  motions: ApiMissionActionOption[];
}

export const fallbackMissionActionCatalog: MissionActionCatalog = {
  formations: [
    {
      id: "grid",
      label: "grid",
      description: "Local fallback grid formation.",
      parameters: [],
      geometryTraits: ["planar", "bounded"],
      solverGeometryRisk: "low"
    },
    {
      id: "line",
      label: "line",
      description: "Local fallback x-axis line formation.",
      parameters: [],
      geometryTraits: ["planar", "collinear"],
      solverGeometryRisk: "high"
    },
    {
      id: "column",
      label: "column",
      description: "Local fallback z-axis column formation.",
      parameters: [],
      geometryTraits: ["planar", "collinear"],
      solverGeometryRisk: "high"
    },
    {
      id: "wedge",
      label: "wedge",
      description: "Local fallback wedge formation.",
      parameters: [],
      geometryTraits: ["planar", "bounded"],
      solverGeometryRisk: "medium"
    },
    {
      id: "ring",
      label: "ring",
      description: "Local fallback ring formation.",
      parameters: [],
      geometryTraits: ["planar", "supports_closed_loops"],
      solverGeometryRisk: "low"
    },
    {
      id: "square_patrol",
      label: "square patrol",
      description: "Local fallback square-corner patrol with interior rovers.",
      parameters: ["random_walk_amplitude_m"],
      geometryTraits: ["planar", "bounded", "requires_5_agents"],
      solverGeometryRisk: "low"
    },
    {
      id: "random_cloud",
      label: "random cloud",
      description: "Local fallback deterministic random cloud.",
      parameters: [],
      geometryTraits: ["bounded", "stochastic_deterministic"],
      solverGeometryRisk: "medium"
    }
  ],
  motions: [
    {
      id: "static",
      label: "static",
      description: "Local fallback static motion.",
      parameters: [],
      geometryTraits: [],
      solverGeometryRisk: "low"
    },
    {
      id: "random_walk",
      label: "random walk",
      description: "Local fallback bounded random walk.",
      parameters: ["random_walk_amplitude_m"],
      geometryTraits: [],
      solverGeometryRisk: "low"
    },
    {
      id: "forward",
      label: "forward",
      description: "Local fallback forward motion.",
      parameters: ["speed_mps"],
      geometryTraits: [],
      solverGeometryRisk: "low"
    },
    {
      id: "path_follow",
      label: "path follow",
      description: "Local fallback loop path motion.",
      parameters: ["path"],
      geometryTraits: [],
      solverGeometryRisk: "low"
    }
  ]
};

function validateCatalogPayload(payload: unknown): ValidatedApiMissionActionCatalog {
  if (!payload || typeof payload !== "object") {
    throw new Error("mission action catalog response is not an object");
  }

  const catalog = payload as ApiMissionActionCatalog;
  if (!Array.isArray(catalog.formations)) {
    throw new Error("mission action catalog response is missing formations");
  }
  if (!Array.isArray(catalog.motions)) {
    throw new Error("mission action catalog response is missing motions");
  }
  const validatedCatalog = {
    formations: catalog.formations,
    motions: catalog.motions
  };
  return validatedCatalog;
}

function mapCatalogOption<TId extends string>(
  option: ApiMissionActionOption
): MissionActionCatalogOption<TId> {
  if (!option.id || !option.label) {
    throw new Error("mission action catalog option is missing id or label");
  }

  const catalogOption: MissionActionCatalogOption<TId> = {
    id: option.id as TId,
    label: option.label,
    description: option.description ?? "",
    parameters: option.parameters ?? [],
    geometryTraits: option.geometry_traits ?? [],
    solverGeometryRisk: option.solver_geometry_risk ?? "low"
  };
  return catalogOption;
}

export async function requestMissionActionCatalog(
  endpointUrl = defaultMissionActionCatalogEndpoint
): Promise<MissionActionCatalog> {
  const catalogResponse = await fetch(endpointUrl);
  if (!catalogResponse.ok) {
    const errorText = await catalogResponse.text();
    throw new Error(
      `mission action catalog request failed with ${catalogResponse.status}: ${errorText}`
    );
  }

  const payload = await catalogResponse.json();
  const catalogPayload = validateCatalogPayload(payload);
  const catalog: MissionActionCatalog = {
    formations: catalogPayload.formations.map((option) => (
      mapCatalogOption<FormationMode>(option)
    )),
    motions: catalogPayload.motions.map((option) => (
      mapCatalogOption<MotionMode>(option)
    ))
  };
  return catalog;
}
