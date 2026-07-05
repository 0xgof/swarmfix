import { Object3D, Raycaster, Scene, Vector2, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { loadSceneTrace } from "../data/loadSceneTrace";
import type { SceneTrace } from "../data/sceneTypes";
import type { Position3D } from "../animation/liveMotion";
import {
  buildInitialLiveSolveResponse,
  buildLiveSolveRequest,
  type LiveSolveRequest
} from "../live/liveSolveTypes";
import {
  requestMissionActionCatalog,
  type MissionActionCatalog
} from "../live/missionActionCatalogClient";
import { requestMissionActionPositions } from "../live/missionActionPositionsClient";
import { defaultLiveSolveEndpoint, requestLiveSolve } from "../live/liveSolverClient";
import { LiveSolveScheduler } from "../live/liveSolveScheduler";
import {
  defaultLiveSolverHealthEndpoint,
  requestLiveSolverHealth,
  updateConnectionState,
  type LiveSolverConnectionState,
  type LiveSolverConnectionStatus
} from "../live/liveSolverHealthClient";
import {
  BrowserEventBuffer,
  createObservationEvent,
  createViewerSession,
  type ViewerObservabilitySession
} from "../observability/eventBuffer";
import { flushObservationEvents } from "../observability/eventFlush";
import { PerformanceMonitor } from "../observability/performance/PerformanceMonitor";
import { flushPerformanceSamples } from "../observability/performance/performanceFlush";
import { createCamera } from "../scene/camera";
import { createSwarmScene } from "../scene/createScene";
import { disposeSceneGraph } from "../scene/disposeScene";
import { buildLiveEstimationFrame } from "../simulation/liveEstimation";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";
import { publishNewtonSharedState } from "../newton/newtonSharedState";
import { fallbackMissionActionPositions } from "../simulation/missionActionFallback";
import {
  createViewerState,
  createMissionAgentIds,
  maxUwbLinksPerAgentLimit,
  type LayerVisibility,
  type ViewerState
} from "./ViewerState";
import {
  buildIterationControlModel,
  buildLayerControlItems
} from "./layerControlModel";
import { buildEdgeInspectorModel } from "../ui/EdgeDetailsPanel";
import { createLayerControls } from "../ui/LayerControls";
import { buildNodeInspectorModel } from "../ui/NodeDetailsPanel";
import { createIterationSlider } from "../ui/IterationSlider";
import {
  createLinkCountControl,
  updateLinkCountDiagnostics
} from "../ui/LinkCountControl";
import { createCameraFollowControl } from "../ui/CameraFollowControl";
import { createMissionActionControls } from "../ui/MissionActionControls";
import { createSidePanel } from "../ui/SidePanel";
import { getCostBreakdown } from "../ui/CostBreakdownPanel";
import { getPositionErrorBreakdown } from "../ui/PositionErrorPanel";
import { buildConnectionStatusModel } from "../ui/ConnectionStatusPanel";
import {
  createViewportConnectionBadge,
  updateViewportConnectionBadge
} from "../ui/ViewportConnectionBadge";
import { formatMeters, formatVector } from "../utils/formatting";

const CAMERA_FOLLOW_PADDING = 1.35;
const CAMERA_FOLLOW_MIN_DISTANCE_M = 8.0;
const CAMERA_FOLLOW_ZOOM_BEZIER_STEP = 0.38;
const CAMERA_FOLLOW_EPSILON_M = 0.001;
const CAMERA_FOLLOW_MANUAL_ZOOM_EPSILON_M = 0.05;
const MISSION_ACTION_POSITION_REQUEST_INTERVAL_S = 1 / 30;
type MissionPositionSource = "backend" | "local_fallback";
const CAMERA_FOLLOW_FALLBACK_DIRECTION = (() => {
  const x = 1.0;
  const y = 12.0;
  const z = 19.0;
  const length = Math.hypot(x, y, z);
  const direction = [x / length, y / length, z / length] as const;
  return direction;
})();

function cubicBezierEaseInOut(progress: number): number {
  const clampedProgress = Math.min(1.0, Math.max(0.0, progress));
  const easedProgress = (
    3.0 * clampedProgress ** 2
    - 2.0 * clampedProgress ** 3
  );
  return easedProgress;
}

export class App {
  private root: HTMLElement;
  private sceneUrl: string;
  private viewerState: ViewerState | null;
  private panel: HTMLElement | null;
  private renderer: WebGLRenderer | null;
  private viewport: HTMLElement | null;
  private animationFrame: number | null;
  private controls: OrbitControls | null;
  private camera: ReturnType<typeof createCamera> | null;
  private scene: Scene | null;
  private startedAtMs: number;
  private liveSolveScheduler: LiveSolveScheduler;
  private observabilitySession: ViewerObservabilitySession;
  private performanceMonitor: PerformanceMonitor;
  private eventBuffer: BrowserEventBuffer;
  private flushedPerformanceSamples: number;
  private connectionState: LiveSolverConnectionState;
  private lastRenderedConnectionStatus: LiveSolverConnectionStatus | null;
  private connectionBadge: HTMLElement | null;
  private previousSelectedUwbLinks: LiveEstimationFrame["uwbLinks"];
  private latestUwbSelection: LiveEstimationFrame["uwbSelection"] | null;
  private linkCountControl: HTMLElement | null = null;
  private cameraFollowDistanceM: number | null;
  private cameraFollowZoomReleasedByManualInput: boolean;
  private missionActionControlsHost: HTMLElement | null;
  private latestBackendMissionPositions: Map<string, Position3D> | null;
  private missionPositionSource: MissionPositionSource;
  private missionPositionRequestInFlight: boolean;
  private lastMissionPositionRequestAtS: number | null;
  private latestLiveSolveRequest: LiveSolveRequest | null;

  constructor(root: HTMLElement,
              sceneUrl = "/examples/full_workflow_demo.json") {
    this.root = root;
    this.sceneUrl = sceneUrl;
    this.viewerState = null;
    this.panel = null;
    this.renderer = null;
    this.viewport = null;
    this.animationFrame = null;
    this.controls = null;
    this.camera = null;
    this.scene = null;
    this.startedAtMs = performance.now();
    this.liveSolveScheduler = new LiveSolveScheduler(requestLiveSolve, 250);
    this.observabilitySession = createViewerSession({
      component: "viewer",
      mode: "normal"
    });
    this.performanceMonitor = new PerformanceMonitor({
      traceId: this.observabilitySession.traceId
    });
    this.eventBuffer = new BrowserEventBuffer();
    this.flushedPerformanceSamples = 0;
    this.connectionState = {
      status: "unknown",
      lastError: null,
      lastHealthyAtMs: null
    };
    this.lastRenderedConnectionStatus = null;
    this.connectionBadge = null;
    this.previousSelectedUwbLinks = [];
    this.latestUwbSelection = null;
    this.cameraFollowDistanceM = null;
    this.cameraFollowZoomReleasedByManualInput = false;
    this.missionActionControlsHost = null;
    this.latestBackendMissionPositions = null;
    this.missionPositionSource = "local_fallback";
    this.missionPositionRequestInFlight = false;
    this.lastMissionPositionRequestAtS = null;
    this.latestLiveSolveRequest = null;
  }

  getCameraForTest(): ReturnType<typeof createCamera> | null {
    return this.camera;
  }

  async start(): Promise<void> {
    try {
      const sceneTrace = await loadSceneTrace(this.sceneUrl);
      this.mount(sceneTrace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.root.textContent = `Unable to load SwarmFix scene: ${message}`;
    }
  }

  mount(sceneTrace: SceneTrace): void {
    this.destroy();
    this.root.innerHTML = "";
    this.viewerState = createViewerState(sceneTrace);
    this.observabilitySession = createViewerSession({
      component: "viewer",
      scenario: sceneTrace.metadata.scenario,
      mode: "normal"
    });
    this.performanceMonitor = new PerformanceMonitor({
      traceId: this.observabilitySession.traceId
    });
    this.eventBuffer = new BrowserEventBuffer();
    this.flushedPerformanceSamples = 0;
    this.connectionState = {
      status: "unknown",
      lastError: null,
      lastHealthyAtMs: null
    };
    this.lastRenderedConnectionStatus = null;
    this.previousSelectedUwbLinks = [];
    this.latestUwbSelection = null;
    this.cameraFollowDistanceM = null;
    this.cameraFollowZoomReleasedByManualInput = false;
    this.missionActionControlsHost = null;
    this.latestBackendMissionPositions = null;
    this.missionPositionSource = "local_fallback";
    this.missionPositionRequestInFlight = false;
    this.lastMissionPositionRequestAtS = null;
    const initialLiveFrame = buildLiveEstimationFrame(
      sceneTrace,
      0,
      this.viewerState.maxUwbLinksPerAgent,
      this.viewerState.motionAmplitudeM,
      this.viewerState.missionAction
    );
    this.previousSelectedUwbLinks = initialLiveFrame.uwbLinks;
    this.latestUwbSelection = initialLiveFrame.uwbSelection;
    this.liveSolveScheduler = new LiveSolveScheduler(
      (request) => this.requestLiveSolveWithObservability(request),
      250,
      buildInitialLiveSolveResponse(sceneTrace),
      {
        healthCheck: () => this.requestLiveSolverHealthWithObservability()
      }
    );
    this.recordViewerEvent("viewer_session_started", "viewer-session-started", {
      scenario: sceneTrace.metadata.scenario,
      agent_count: sceneTrace.truth.nodes.length
    });
    this.recordViewerEvent("viewer_scene_loaded", "viewer-scene-loaded", {
      scenario: sceneTrace.metadata.scenario
    });

    const shell = document.createElement("main");
    shell.className = "viewer-shell";
    const viewport = document.createElement("section");
    viewport.className = "viewer-viewport";
    this.viewport = viewport;
    const panel = createSidePanel();
    this.panel = panel;
    panel.innerHTML = `
      <h1>SwarmFix</h1>
      <p>${sceneTrace.metadata.scenario}</p>
      <p>${sceneTrace.truth.nodes.length} agents</p>
    `;

    const connectionStatus = document.createElement("section");
    connectionStatus.className = "connection-status";
    panel.append(connectionStatus);
    this.renderConnectionStatus();
    panel.append(createLayerControls({
      layers: this.layerControlItems(),
      onChange: (key, visible) => {
        this.viewerState!.setLayerVisible(key as keyof LayerVisibility, visible);
        this.refreshScene();
      }
    }));
    panel.append(createIterationSlider({
      ...buildIterationControlModel(
        this.viewerState.sceneTrace,
        this.viewerState.selectedIteration,
        true
      ),
      onChange: (iteration) => {
        this.viewerState!.setIteration(iteration);
        this.refreshScene();
      }
    }));
    this.linkCountControl = createLinkCountControl({
      max: maxUwbLinksPerAgentLimit(this.viewerState.sceneTrace),
      value: this.viewerState.maxUwbLinksPerAgent,
      diagnostics: this.linkCountDiagnostics(),
      onChange: (count) => {
        this.viewerState!.setMaxUwbLinksPerAgent(count);
        this.refreshScene();
      }
    });
    panel.append(this.linkCountControl);
    panel.append(createCameraFollowControl({
      followsBarycenter: this.viewerState.cameraFollowsSwarmBarycenter,
      onChange: (followsBarycenter) => {
        this.viewerState!.setCameraFollowsSwarmBarycenter(followsBarycenter);
        this.cameraFollowDistanceM = null;
        this.cameraFollowZoomReleasedByManualInput = false;
        this.refreshScene();
      }
    }));
    this.missionActionControlsHost = document.createElement("section");
    this.missionActionControlsHost.className = "mission-action-controls-host";
    panel.append(this.missionActionControlsHost);
    this.renderMissionActionControls();
    void this.loadMissionActionCatalog();
    const inspector = document.createElement("section");
    inspector.className = "inspector";
    panel.append(inspector);
    shell.append(viewport, panel);
    this.root.append(shell);
    this.initializeRenderer(viewport);
    this.connectionBadge = createViewportConnectionBadge({
      status: this.liveConnectionStatus(),
      endpointUrl: defaultLiveSolverHealthEndpoint,
      lastError: this.connectionState.lastError
    });
    viewport.append(this.connectionBadge);
    this.renderConnectionStatus();
    this.refreshScene();
    this.renderInspector();
    this.startAnimationLoop();
  }

  private initializeRenderer(viewport: HTMLElement): void {
    if (!this.viewerState) {
      return;
    }

    viewport.innerHTML = "";
    const width = Math.max(800, viewport.clientWidth || 800);
    const height = Math.max(500, viewport.clientHeight || 500);
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    this.renderer = renderer;
    this.camera = createCamera(width, height);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(8, 0, 5);
    renderer.domElement.addEventListener("click", (event) => {
      if (!this.camera || !this.scene) {
        return;
      }
      const selectedObject = this.pickObject(event, renderer, this.camera, this.scene);
      this.applySelection(selectedObject);
      this.renderInspector();
    });
    viewport.append(renderer.domElement);
  }

  private layerControlItems(): Array<{ key: string; label: string; visible: boolean }> {
    if (!this.viewerState) {
      return [];
    }
    const items = buildLayerControlItems(
      this.viewerState.sceneTrace,
      this.viewerState.layers
    );
    return items;
  }

  private renderMissionActionControls(catalog?: MissionActionCatalog): void {
    if (!this.viewerState || !this.missionActionControlsHost) {
      return;
    }

    const controls = createMissionActionControls({
      value: this.viewerState.missionAction,
      droneCount: this.viewerState.missionDroneCount,
      catalog,
      onChange: (nextAction) => {
        const timeSeconds = (performance.now() - this.startedAtMs) / 1000;
        const previousFormation = this.viewerState!.missionAction.formation;
        this.viewerState!.setMissionAction(nextAction, timeSeconds);
        this.lastMissionPositionRequestAtS = null;
        this.latestBackendMissionPositions = null;
        if (nextAction.formation && nextAction.formation !== previousFormation) {
          this.previousSelectedUwbLinks = [];
        }
        this.recordViewerEvent(
          "viewer_mission_action_changed",
          "viewer-mission-action",
          this.actionContextFields()
        );
        this.refreshScene();
      },
      onDroneCountChange: (nextCount) => {
        this.viewerState!.setMissionDroneCount(nextCount);
        this.resetMissionPositionState();
        this.previousSelectedUwbLinks = [];
        this.latestUwbSelection = null;
        this.renderMissionActionControls(catalog);
        this.recordViewerEvent(
          "viewer_mission_drone_count_changed",
          "viewer-mission-drone-count",
          this.actionContextFields()
        );
        this.refreshScene();
      }
    });
    this.missionActionControlsHost.innerHTML = "";
    this.missionActionControlsHost.append(controls);
  }

  private async loadMissionActionCatalog(): Promise<void> {
    const controlHost = this.missionActionControlsHost;
    if (!controlHost) {
      return;
    }

    try {
      const catalog = await requestMissionActionCatalog();
      if (this.missionActionControlsHost !== controlHost) {
        return;
      }
      this.renderMissionActionControls(catalog);
    } catch {
      return;
    }
  }

  private refreshScene(): void {
    if (!this.viewerState) {
      return;
    }

    const timeSeconds = (performance.now() - this.startedAtMs) / 1000;
    const displayFrame = this.liveSolveScheduler.getDisplayFrame();
    const liveFrame = this.queueLiveSolve(timeSeconds);
    const nextScene = createSwarmScene(
      this.viewerState.sceneTrace,
      this.viewerState.selectedIteration,
      this.viewerState.layers,
      timeSeconds,
      this.viewerState.maxUwbLinksPerAgent,
      this.viewerState.motionAmplitudeM,
      displayFrame,
      this.viewerState.missionAction,
      liveFrame
    );
    this.updateCameraFollowTarget(liveFrame);
    this.replaceScene(nextScene);
    this.renderInspector();
  }

  private startAnimationLoop(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }

    const animate = (): void => {
      const frameStartMs = performance.now();
      if (!this.viewerState || !this.renderer || !this.camera || !this.viewport) {
        return;
      }

      const nowMs = performance.now();
      const timeSeconds = (nowMs - this.startedAtMs) / 1000;
      const displayFrame = this.liveSolveScheduler.getDisplayFrame(nowMs);
      const liveFrame = this.queueLiveSolve(timeSeconds);
      this.renderConnectionStatus();
      const nextScene = createSwarmScene(
        this.viewerState.sceneTrace,
        this.viewerState.selectedIteration,
        this.viewerState.layers,
        timeSeconds,
        this.viewerState.maxUwbLinksPerAgent,
        this.viewerState.motionAmplitudeM,
        displayFrame,
        this.viewerState.missionAction,
        liveFrame
      );
      this.updateCameraFollowTarget(liveFrame);
      this.replaceScene(nextScene);
      this.controls?.update();
      this.renderer.render(nextScene, this.camera);
      this.performanceMonitor.recordFrame(
        `viewer-frame-${Math.round(timeSeconds * 1000)}`,
        performance.now() - frameStartMs,
        {
          selected_uwb_links: displayFrame?.metadata.selected_uwb_count ?? 0,
          ...this.actionContextFields()
        }
      );
      this.flushObservability();
      if (this.liveSolveScheduler.consumeFrameChanged()) {
        this.publishNewtonState(timeSeconds);
        this.renderConnectionStatus();
        this.renderInspector();
      }
      this.animationFrame = requestAnimationFrame(animate);
    };

    this.animationFrame = requestAnimationFrame(animate);
  }

  private replaceScene(nextScene: Scene): void {
    if (this.scene && this.scene !== nextScene) {
      disposeSceneGraph(this.scene);
    }
    this.scene = nextScene;
  }

  destroy(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.controls?.dispose();
    this.controls = null;
    disposeSceneGraph(this.scene);
    this.scene = null;
    if (this.renderer) {
      this.renderer.forceContextLoss();
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.camera = null;
    this.viewport = null;
    this.panel = null;
    this.connectionBadge = null;
    this.linkCountControl = null;
    this.cameraFollowDistanceM = null;
    this.cameraFollowZoomReleasedByManualInput = false;
    this.missionActionControlsHost = null;
    this.latestBackendMissionPositions = null;
    this.missionPositionSource = "local_fallback";
    this.missionPositionRequestInFlight = false;
    this.lastMissionPositionRequestAtS = null;
  }

  private linkCountDiagnostics(): {
    candidateLinkCount: number;
    selectedLinkCount: number;
    adaptiveSelectionEnabled: boolean;
  } | undefined {
    if (!this.latestUwbSelection) {
      return undefined;
    }

    const diagnostics = {
      candidateLinkCount: this.latestUwbSelection.candidateLinkCount,
      selectedLinkCount: this.latestUwbSelection.selectedLinkCount,
      adaptiveSelectionEnabled: this.latestUwbSelection.adaptiveSelectionEnabled
    };
    return diagnostics;
  }

  private queueLiveSolve(timeSeconds: number): LiveEstimationFrame | null {
    if (!this.viewerState) {
      return null;
    }

    this.requestBackendMissionPositions(timeSeconds);
    const missionPositions = this.missionPositionsForLiveFrame(timeSeconds);
    const liveFrame = buildLiveEstimationFrame(
      this.viewerState.sceneTrace,
      timeSeconds,
      this.viewerState.maxUwbLinksPerAgent,
      this.viewerState.motionAmplitudeM,
      this.viewerState.missionAction,
      {},
      this.previousSelectedUwbLinks,
      missionPositions
    );
    this.previousSelectedUwbLinks = liveFrame.uwbLinks;
    this.latestUwbSelection = liveFrame.uwbSelection;
    if (this.linkCountControl) {
      updateLinkCountDiagnostics(this.linkCountControl, this.linkCountDiagnostics());
    }
    void this.liveSolveScheduler.tick(performance.now(), () => {
      const request = buildLiveSolveRequest(
        this.viewerState!.sceneTrace,
        liveFrame,
        this.viewerState!.maxUwbLinksPerAgent
      );
      request.trace_context = {
        session_id: this.observabilitySession.sessionId,
        trace_id: this.observabilitySession.traceId,
        span_id: `viewer-live-solve-${Math.round(timeSeconds * 1000)}`,
        correlation_id: (
          `${this.viewerState!.sceneTrace.metadata.scenario}`
          + `-links_per_drone_${this.viewerState!.maxUwbLinksPerAgent}`
        ),
        request_id: `solve-${Math.round(performance.now())}`,
        scenario: this.viewerState!.sceneTrace.metadata.scenario
      };
      this.latestLiveSolveRequest = request;
      this.publishNewtonState(timeSeconds, request);
      return request;
    });
    return liveFrame;
  }

  private publishNewtonState(timeSeconds: number,
                             request: LiveSolveRequest | null = this.latestLiveSolveRequest): void {
    if (!this.viewerState) {
      return;
    }
    const latestResponse = this.liveSolveScheduler.getLatestSolvedFrame();
    publishNewtonSharedState({
      schemaVersion: this.viewerState.sceneTrace.schema_version,
      timestampMs: Math.round(timeSeconds * 1000),
      missionAction: this.viewerState.missionAction,
      liveSolveRequest: request,
      liveSolveResponse: latestResponse,
      selectedUwbLinks: request?.selected_uwb_links ?? [],
      solverBackend: latestResponse?.metadata.solver ?? null
    });
  }

  private missionPositionsForLiveFrame(timeSeconds: number): Map<string, Position3D> {
    if (!this.viewerState) {
      return new Map();
    }

    if (this.latestBackendMissionPositions) {
      this.missionPositionSource = "backend";
      return this.latestBackendMissionPositions;
    }

    this.missionPositionSource = "local_fallback";
    const agentIds = this.activeMissionAgentIds();
    const fallbackPositions = fallbackMissionActionPositions(
      agentIds,
      this.viewerState.missionAction,
      timeSeconds
    );
    return fallbackPositions;
  }

  private requestBackendMissionPositions(timeSeconds: number): void {
    if (!this.viewerState || this.missionPositionRequestInFlight) {
      return;
    }

    if (
      this.lastMissionPositionRequestAtS !== null
      && timeSeconds - this.lastMissionPositionRequestAtS
        < MISSION_ACTION_POSITION_REQUEST_INTERVAL_S
    ) {
      return;
    }

    const agentIds = this.activeMissionAgentIds();
    const missionAction = this.viewerState.missionAction;
    const requestActionKey = this.missionActionCacheKey();
    this.missionPositionRequestInFlight = true;
    this.lastMissionPositionRequestAtS = timeSeconds;
    void requestMissionActionPositions(agentIds, missionAction, timeSeconds)
      .then((positions) => {
        if (!this.viewerState || this.missionActionCacheKey() !== requestActionKey) {
          return;
        }
        this.latestBackendMissionPositions = positions;
        this.refreshScene();
      })
      .catch(() => {
        if (!this.latestBackendMissionPositions) {
          this.missionPositionSource = "local_fallback";
        }
      })
      .finally(() => {
        this.missionPositionRequestInFlight = false;
      });
  }

  private missionActionCacheKey(): string {
    if (!this.viewerState) {
      return "";
    }

    const key = JSON.stringify({
      missionAction: this.viewerState.missionAction,
      missionDroneCount: this.viewerState.missionDroneCount
    });
    return key;
  }

  private activeMissionAgentIds(): string[] {
    if (!this.viewerState) {
      return [];
    }

    const agentIds = createMissionAgentIds(this.viewerState.missionDroneCount);
    return agentIds;
  }

  private resetMissionPositionState(): void {
    this.latestBackendMissionPositions = null;
    this.missionPositionSource = "local_fallback";
    this.missionPositionRequestInFlight = false;
    this.lastMissionPositionRequestAtS = null;
  }

  private updateCameraFollowTarget(liveFrame: LiveEstimationFrame | null): void {
    if (!this.viewerState?.cameraFollowsSwarmBarycenter) {
      this.cameraFollowDistanceM = null;
      this.cameraFollowZoomReleasedByManualInput = false;
      return;
    }

    if (
      !this.controls
      || !this.camera
      || !liveFrame
      || liveFrame.truthPositions.size === 0
    ) {
      return;
    }

    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (const position of liveFrame.truthPositions.values()) {
      sumX += position[0];
      sumY += position[1];
      sumZ += position[2];
    }

    const count = liveFrame.truthPositions.size;
    const barycenterX = sumX / count;
    const barycenterY = sumY / count;
    const barycenterZ = sumZ / count;
    let swarmRadiusM = 0;
    for (const position of liveFrame.truthPositions.values()) {
      const distanceFromBarycenterM = Math.hypot(
        position[0] - barycenterX,
        position[1] - barycenterY,
        position[2] - barycenterZ
      );
      swarmRadiusM = Math.max(swarmRadiusM, distanceFromBarycenterM);
    }

    const currentOffsetX = this.camera.position.x - this.controls.target.x;
    const currentOffsetY = this.camera.position.y - this.controls.target.y;
    const currentOffsetZ = this.camera.position.z - this.controls.target.z;
    const currentDistanceM = Math.hypot(currentOffsetX, currentOffsetY, currentOffsetZ);
    const cameraDirection = currentDistanceM > CAMERA_FOLLOW_EPSILON_M
      ? [
        currentOffsetX / currentDistanceM,
        currentOffsetY / currentDistanceM,
        currentOffsetZ / currentDistanceM
      ] as const
      : CAMERA_FOLLOW_FALLBACK_DIRECTION;
    const verticalFovRad = this.camera.fov * Math.PI / 180.0;
    const horizontalFovRad = 2.0 * Math.atan(
      Math.tan(verticalFovRad / 2.0) * this.camera.aspect
    );
    const limitingFovRad = Math.min(verticalFovRad, horizontalFovRad);
    const fitDistanceM = Math.max(
      CAMERA_FOLLOW_MIN_DISTANCE_M,
      swarmRadiusM * CAMERA_FOLLOW_PADDING / Math.sin(limitingFovRad / 2.0)
    );
    const followDistanceM = this.nextCameraFollowDistance(fitDistanceM, currentDistanceM);

    this.controls.target.set(barycenterX, barycenterY, barycenterZ);
    this.camera.position.set(
      barycenterX + cameraDirection[0] * followDistanceM,
      barycenterY + cameraDirection[1] * followDistanceM,
      barycenterZ + cameraDirection[2] * followDistanceM
    );
    this.camera.lookAt(barycenterX, barycenterY, barycenterZ);
  }

  private nextCameraFollowDistance(fitDistanceM: number,
                                   currentDistanceM: number): number {
    const storedDistanceM = this.cameraFollowDistanceM;
    if (
      storedDistanceM !== null
      && Math.abs(currentDistanceM - storedDistanceM) > CAMERA_FOLLOW_MANUAL_ZOOM_EPSILON_M
    ) {
      this.cameraFollowZoomReleasedByManualInput = true;
      this.cameraFollowDistanceM = currentDistanceM;
    }

    if (this.cameraFollowZoomReleasedByManualInput) {
      this.cameraFollowDistanceM = currentDistanceM;
      return currentDistanceM;
    }

    const currentFollowDistanceM = (
      storedDistanceM !== null
      && Math.abs(currentDistanceM - storedDistanceM) <= CAMERA_FOLLOW_MANUAL_ZOOM_EPSILON_M
    )
      ? storedDistanceM
      : currentDistanceM;
    const distanceDeltaM = fitDistanceM - currentFollowDistanceM;
    if (Math.abs(distanceDeltaM) <= CAMERA_FOLLOW_EPSILON_M) {
      this.cameraFollowDistanceM = fitDistanceM;
    } else {
      const smoothingProgress = cubicBezierEaseInOut(CAMERA_FOLLOW_ZOOM_BEZIER_STEP);
      this.cameraFollowDistanceM = currentFollowDistanceM + distanceDeltaM * smoothingProgress;
    }

    return this.cameraFollowDistanceM;
  }

  private async requestLiveSolveWithObservability(request: Parameters<typeof requestLiveSolve>[0]) {
    const startedAtMs = performance.now();
    const spanId = request.trace_context?.span_id ?? `viewer-live-solve-${Math.round(startedAtMs)}`;
    this.recordViewerEvent("viewer_live_solve_request_started", spanId, {
      selected_uwb_links: request.selected_uwb_links.length,
      endpoint: defaultLiveSolveEndpoint,
      ...this.uwbSelectionFields(),
      ...this.actionContextFields()
    });
    this.flushObservability();

    try {
      const response = await requestLiveSolve(request);
      const durationMs = performance.now() - startedAtMs;
      this.connectionState = updateConnectionState(this.connectionState, {
        ok: true,
        nowMs: performance.now()
      });
      this.performanceMonitor.recordLiveSolve(spanId, durationMs, {
        selected_uwb_links: request.selected_uwb_links.length,
        ...this.uwbSelectionFields(),
        ...this.actionContextFields()
      });
      this.recordViewerEvent(
        "viewer_live_solve_response_received",
        spanId,
        {
          selected_uwb_count: response.metadata.selected_uwb_count,
          ...this.uwbSelectionFields(),
          ...this.actionContextFields()
        },
        durationMs
      );
      this.renderConnectionStatus();
      this.flushObservability();
      return response;
    } catch (error) {
      const durationMs = performance.now() - startedAtMs;
      this.connectionState = updateConnectionState(this.connectionState, {
        ok: false,
        nowMs: performance.now(),
        error: error instanceof Error ? error.message : String(error)
      });
      this.performanceMonitor.recordLiveSolve(spanId, durationMs, {
        selected_uwb_links: request.selected_uwb_links.length,
        failed: true,
        ...this.uwbSelectionFields(),
        ...this.actionContextFields()
      });
      this.recordViewerEvent(
        "viewer_live_solve_failed",
        spanId,
        {
          error: error instanceof Error ? error.message : String(error),
          endpoint: defaultLiveSolveEndpoint,
          ...this.uwbSelectionFields(),
          ...this.actionContextFields()
        },
        durationMs
      );
      this.renderConnectionStatus();
      this.flushObservability();
      throw error;
    }
  }

  private async requestLiveSolverHealthWithObservability(): Promise<void> {
    const startedAtMs = performance.now();
    const spanId = `viewer-live-solver-health-${Math.round(startedAtMs)}`;
    try {
      await requestLiveSolverHealth(defaultLiveSolverHealthEndpoint);
      const durationMs = performance.now() - startedAtMs;
      this.connectionState = updateConnectionState(this.connectionState, {
        ok: true,
        nowMs: performance.now()
      });
      this.recordViewerEvent("viewer_live_solver_health_ok", spanId, {
        endpoint: defaultLiveSolverHealthEndpoint
      }, durationMs);
      this.renderConnectionStatus();
      this.flushObservability();
    } catch (error) {
      const durationMs = performance.now() - startedAtMs;
      this.connectionState = updateConnectionState(this.connectionState, {
        ok: false,
        nowMs: performance.now(),
        error: error instanceof Error ? error.message : String(error)
      });
      this.recordViewerEvent("viewer_live_solver_health_failed", spanId, {
        endpoint: defaultLiveSolverHealthEndpoint,
        error: error instanceof Error ? error.message : String(error)
      }, durationMs);
      this.renderConnectionStatus();
      this.flushObservability();
      throw error;
    }
  }

  private liveConnectionStatus(): LiveSolverConnectionStatus {
    const schedulerStatus = this.liveSolveScheduler.getStatus();
    if (schedulerStatus === "retrying" || schedulerStatus === "stale") {
      return schedulerStatus;
    }
    return this.connectionState.status;
  }

  private renderConnectionStatus(): void {
    if (!this.panel) {
      return;
    }
    const statusElement = this.panel.querySelector<HTMLElement>(".connection-status");
    if (!statusElement) {
      return;
    }
    const connectionStatus = this.liveConnectionStatus();
    if (this.connectionBadge) {
      updateViewportConnectionBadge(this.connectionBadge, {
        status: connectionStatus,
        endpointUrl: defaultLiveSolverHealthEndpoint,
        lastError: this.liveSolveScheduler.getError() ?? this.connectionState.lastError
      });
    }
    const statusModel = buildConnectionStatusModel({
      status: connectionStatus,
      endpointUrl: defaultLiveSolverHealthEndpoint,
      lastError: this.liveSolveScheduler.getError() ?? this.connectionState.lastError
    });
    if (connectionStatus !== this.lastRenderedConnectionStatus) {
      this.lastRenderedConnectionStatus = connectionStatus;
      this.recordViewerEvent("viewer_live_solver_connection_status_changed", "viewer-connection", {
        status: connectionStatus,
        endpoint: defaultLiveSolverHealthEndpoint
      });
    }
    statusElement.innerHTML = "";
    const label = document.createElement("h2");
    label.textContent = statusModel.label;
    const detail = document.createElement("p");
    detail.textContent = statusModel.detail;
    statusElement.dataset.tone = statusModel.tone;
    statusElement.append(label, detail);
  }

  private recordViewerEvent(event: string,
                            spanId: string,
                            fields: Record<string, unknown> = {},
                            durationMs: number | null = null): void {
    const observationEvent = createObservationEvent(this.observabilitySession, {
      spanId,
      event,
      durationMs,
      fields
    });
    this.eventBuffer.record(observationEvent);
  }

  private actionContextFields(): Record<string, unknown> {
    const action = this.viewerState?.missionAction;
    if (!action) {
      return {};
    }

    const fields = {
      formation_mode: action.formation,
      motion_mode: action.motion,
      speed_mps: action.speedMps,
      random_walk_amplitude_m: action.randomWalkAmplitudeM,
      mission_position_source: this.missionPositionSource,
      mission_drone_count: this.viewerState?.missionDroneCount ?? 0,
      max_uwb_links_per_agent: this.viewerState?.maxUwbLinksPerAgent ?? 0
    };
    return fields;
  }

  private uwbSelectionFields(): Record<string, unknown> {
    const selection = this.latestUwbSelection;
    if (!selection) {
      return {};
    }

    const fields = {
      candidate_uwb_links: selection.candidateLinkCount,
      selected_uwb_links: selection.selectedLinkCount,
      isolated_agents: selection.isolatedAgentCount,
      graph_components: selection.connectedComponentCount,
      triangle_count: selection.triangleCount,
      selection_policy: selection.selectionPolicy,
      added_links: selection.addedLinks,
      dropped_links: selection.droppedLinks
    };
    return fields;
  }

  private flushObservability(): void {
    void flushObservationEvents(this.eventBuffer, "/observability/events")
      .catch(() => undefined);
    const pendingSamples = this.performanceMonitor.samples()
      .slice(this.flushedPerformanceSamples);
    if (pendingSamples.length === 0) {
      return;
    }
    void flushPerformanceSamples(pendingSamples, "/observability/performance")
      .then(() => {
        this.flushedPerformanceSamples += pendingSamples.length;
      })
      .catch(() => undefined);
  }

  private pickObject(event: MouseEvent,
                     renderer: WebGLRenderer,
                     camera: ReturnType<typeof createCamera>,
                     scene: ReturnType<typeof createSwarmScene>): Object3D | null {
    const bounds = renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
      -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1)
    );
    const raycaster = new Raycaster();
    raycaster.params.Line = { threshold: 0.25 };
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    const selectedObject = hits.find((hit) => hit.object.userData.kind)?.object
      ?? null;
    return selectedObject;
  }

  private applySelection(selectedObject: Object3D | null): void {
    if (!this.viewerState || !selectedObject) {
      return;
    }

    if (selectedObject.userData.kind === "node") {
      this.viewerState.selectNode(selectedObject.userData.agentId);
    }
    if (selectedObject.userData.kind === "edge") {
      this.viewerState.selectEdge(
        `${selectedObject.userData.sourceId}->${selectedObject.userData.targetId}`
      );
    }
  }

  private renderInspector(): void {
    if (!this.viewerState || !this.panel) {
      return;
    }

    const inspector = this.panel.querySelector<HTMLElement>(".inspector");
    if (!inspector) {
      return;
    }
    const liveSolveFrame = this.liveSolveScheduler.getLatestSolvedFrame();

    const cost = getCostBreakdown(
      this.viewerState.sceneTrace,
      this.viewerState.selectedIteration,
      liveSolveFrame
    );
    const costHtml = cost
      ? `<p>cost ${cost.total.toFixed(3)} / GNSS ${cost.gnss.toFixed(3)} / UWB ${cost.uwb.toFixed(3)}</p>`
      : "<p>cost unavailable</p>";
    const positionError = getPositionErrorBreakdown(
      this.viewerState.sceneTrace,
      liveSolveFrame
    );
    const positionErrorHtml = positionError
      ? (
        `<p>position error ${formatMeters(positionError.rmseM)}`
        + ` ${positionError.estimateMethod} RMSE`
        + ` / max ${formatMeters(positionError.maxErrorM)}</p>`
      )
      : "<p>position error unavailable</p>";

    if (this.viewerState.selectedNodeId) {
      const nodeModel = buildNodeInspectorModel(
        this.viewerState.sceneTrace,
        this.viewerState.selectedNodeId,
        this.viewerState.selectedIteration
      );
      inspector.innerHTML = nodeModel
        ? `
          <h2>${nodeModel.agentId}</h2>
          ${costHtml}
          ${positionErrorHtml}
          <p>truth ${formatVector(nodeModel.truthPosition)}</p>
          <p>GNSS ${formatVector(nodeModel.gnssPosition)}</p>
          <p>current ${formatVector(nodeModel.currentEstimate)}</p>
          <p>fused ${formatVector(nodeModel.fusedEstimate)}</p>
          <p>corrected ${formatVector(nodeModel.correctedEstimate)}</p>
          <p>GNSS residual ${formatMeters(nodeModel.gnssResidualNorm)}</p>
          <p>UWB links ${nodeModel.connectedUwbLinks.length}</p>
        `
        : `<h2>No node data</h2>${costHtml}${positionErrorHtml}`;
      return;
    }

    if (this.viewerState.selectedEdgeKey) {
      const [sourceId, targetId] = this.viewerState.selectedEdgeKey.split("->");
      const edgeModel = buildEdgeInspectorModel(
        this.viewerState.sceneTrace,
        sourceId,
        targetId,
        this.viewerState.selectedIteration,
        liveSolveFrame
      );
      inspector.innerHTML = edgeModel
        ? `
          <h2>${edgeModel.sourceId} to ${edgeModel.targetId}</h2>
          ${costHtml}
          ${positionErrorHtml}
          <p>measured ${formatMeters(edgeModel.measuredDistanceM)}</p>
          <p>current ${formatMeters(edgeModel.currentDistanceM)}</p>
          <p>sigma ${formatMeters(edgeModel.sigmaM)}</p>
          <p>residual ${formatMeters(edgeModel.residualM)}</p>
        `
        : `<h2>No edge data</h2>${costHtml}${positionErrorHtml}`;
      return;
    }

    inspector.innerHTML = `<h2>Scene</h2>${costHtml}${positionErrorHtml}`;
  }
}
