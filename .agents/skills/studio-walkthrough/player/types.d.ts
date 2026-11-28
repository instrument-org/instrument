// What the player reads from a built take (data.js), and what an engine
// hands back, for the page scripts beside it.

export interface Chapter {
  caption: string;
  from: number;
  still: string | null;
  title: string;
  to: number;
}

export interface Take {
  chapters: Chapter[];
  duration: number;
  /** The app window's own pixels: a video beside the take, its first frame at `start` (wall-clock ms). */
  pixels?: { src: string; start: number };
  title: string;
  viewport: { h: number; w: number };
}

export interface EngineOptions {
  camera?: boolean;
  captions?: boolean;
  /** Where keys pressed show: small in a corner, or large across the middle. */
  keys?: "center" | "corner";
  loop?: boolean;
  mode?: "full" | "render" | "snippet";
  range?: { from: number; to: number };
}

export interface Engine {
  camera(): { s: number; tx: number; ty: number };
  destroy(): void;
  length: number;
  pause(): void;
  play(): void;
  seekPres(ms: number): void;
  seekRec(ms: number): void;
  setSpeed(speed: number): void;
  state(): { length: number; p: number; playing: boolean; r: number; speed: number };
  stillHtml(): string;
  toggle(): void;
  toPres(ms: number): number;
}
