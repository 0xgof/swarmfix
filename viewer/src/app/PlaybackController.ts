import type { ViewerState } from "./ViewerState";

export class PlaybackController {
  private viewerState: ViewerState;
  private playing: boolean;

  constructor(viewerState: ViewerState) {
    this.viewerState = viewerState;
    this.playing = false;
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  reset(): void {
    this.viewerState.setIteration(0);
    this.pause();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  stepForward(): void {
    if (!this.playing) {
      return;
    }

    const currentIteration = this.viewerState.selectedIteration;
    this.viewerState.setIteration(currentIteration + 1);
    if (this.viewerState.selectedIteration === currentIteration) {
      this.pause();
    }
  }
}
