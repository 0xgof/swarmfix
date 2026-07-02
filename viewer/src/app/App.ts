import { Object3D, Raycaster, Scene, Vector2, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { loadSceneTrace } from "../data/loadSceneTrace";
import type { SceneTrace } from "../data/sceneTypes";
import {
  buildInitialLiveSolveResponse,
  buildLiveSolveRequest
} from "../live/liveSolveTypes";
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
import { createViewerState, type LayerVisibility, ViewerState } from "./ViewerState";
import { buildEdgeInspectorModel } from "../ui/EdgeDetailsPanel";
import { createLayerControls } from "../ui/LayerControls";
import { buildNodeInspectorModel } from "../ui/NodeDetailsPanel";
import { createIterationSlider } from "../ui/IterationSlider";
import { createLinkCountControl } from "../ui/LinkCountControl";
import { createSidePanel } from "../ui/SidePanel";
import { getCostBreakdown } from "../ui/CostBreakdownPanel";
import { buildConnectionStatusModel } from "../ui/ConnectionStatusPanel";
import {
  createViewportConnectionBadge,
  updateViewportConnectionBadge
} from "../ui/ViewportConnectionBadge";
import { formatMeters, formatVector } from "../utils/formatting";

const layerLabels: Record<keyof LayerVisibility, string> = {
  truth: "truth",
  gnss: "GNSS",
  gnssUncertainty: "GNSS sigma",
  gnssOnly: "GNSS only",
  fused: "fused",
  corrected: "corrected",
  references: "reference",
  uwbLinks: "UWB",
  residuals: "residuals",
  cost: "cost"
};

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
      min: 0,
      max: Math.max(0, this.viewerState.sceneTrace.trace.iterations.length - 1),
      value: this.viewerState.selectedIteration,
      onChange: (iteration) => {
        this.viewerState!.setIteration(iteration);
        this.refreshScene();
      }
    }));
    panel.append(createLinkCountControl({
      max: this.viewerState.maxUwbLinksPerAgent,
      value: this.viewerState.maxUwbLinksPerAgent,
      onChange: (count) => {
        this.viewerState!.setMaxUwbLinksPerAgent(count);
        this.refreshScene();
      }
    }));
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
    const items = (Object.keys(layerLabels) as Array<keyof LayerVisibility>)
      .map((key) => ({
        key,
        label: layerLabels[key],
        visible: this.viewerState?.layers[key] ?? false
      }));
    return items;
  }

  private refreshScene(): void {
    if (!this.viewerState) {
      return;
    }

    const timeSeconds = (performance.now() - this.startedAtMs) / 1000;
    const displayFrame = this.liveSolveScheduler.getDisplayFrame();
    this.queueLiveSolve(timeSeconds);
    const nextScene = createSwarmScene(
      this.viewerState.sceneTrace,
      this.viewerState.selectedIteration,
      this.viewerState.layers,
      timeSeconds,
      this.viewerState.maxUwbLinksPerAgent,
      this.viewerState.motionAmplitudeM,
      displayFrame
    );
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
      this.queueLiveSolve(timeSeconds);
      this.renderConnectionStatus();
      const nextScene = createSwarmScene(
        this.viewerState.sceneTrace,
        this.viewerState.selectedIteration,
        this.viewerState.layers,
        timeSeconds,
        this.viewerState.maxUwbLinksPerAgent,
        this.viewerState.motionAmplitudeM,
        displayFrame
      );
      this.replaceScene(nextScene);
      this.controls?.update();
      this.renderer.render(nextScene, this.camera);
      this.performanceMonitor.recordFrame(
        `viewer-frame-${Math.round(timeSeconds * 1000)}`,
        performance.now() - frameStartMs,
        { selected_uwb_links: displayFrame?.metadata.selected_uwb_count ?? 0 }
      );
      this.flushObservability();
      if (this.liveSolveScheduler.consumeFrameChanged()) {
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
  }

  private queueLiveSolve(timeSeconds: number): void {
    if (!this.viewerState) {
      return;
    }

    const liveFrame = buildLiveEstimationFrame(
      this.viewerState.sceneTrace,
      timeSeconds,
      this.viewerState.maxUwbLinksPerAgent,
      this.viewerState.motionAmplitudeM
    );
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
      return request;
    });
  }

  private async requestLiveSolveWithObservability(request: Parameters<typeof requestLiveSolve>[0]) {
    const startedAtMs = performance.now();
    const spanId = request.trace_context?.span_id ?? `viewer-live-solve-${Math.round(startedAtMs)}`;
    this.recordViewerEvent("viewer_live_solve_request_started", spanId, {
      selected_uwb_links: request.selected_uwb_links.length,
      endpoint: defaultLiveSolveEndpoint
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
        selected_uwb_links: request.selected_uwb_links.length
      });
      this.recordViewerEvent(
        "viewer_live_solve_response_received",
        spanId,
        { selected_uwb_count: response.metadata.selected_uwb_count },
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
        failed: true
      });
      this.recordViewerEvent(
        "viewer_live_solve_failed",
        spanId,
        {
          error: error instanceof Error ? error.message : String(error),
          endpoint: defaultLiveSolveEndpoint
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
          <p>truth ${formatVector(nodeModel.truthPosition)}</p>
          <p>GNSS ${formatVector(nodeModel.gnssPosition)}</p>
          <p>current ${formatVector(nodeModel.currentEstimate)}</p>
          <p>fused ${formatVector(nodeModel.fusedEstimate)}</p>
          <p>corrected ${formatVector(nodeModel.correctedEstimate)}</p>
          <p>GNSS residual ${formatMeters(nodeModel.gnssResidualNorm)}</p>
          <p>UWB links ${nodeModel.connectedUwbLinks.length}</p>
        `
        : `<h2>No node data</h2>${costHtml}`;
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
          <p>measured ${formatMeters(edgeModel.measuredDistanceM)}</p>
          <p>current ${formatMeters(edgeModel.currentDistanceM)}</p>
          <p>sigma ${formatMeters(edgeModel.sigmaM)}</p>
          <p>residual ${formatMeters(edgeModel.residualM)}</p>
        `
        : `<h2>No edge data</h2>${costHtml}`;
      return;
    }

    inspector.innerHTML = `<h2>Scene</h2>${costHtml}`;
  }
}
