import { type RevealState, advance, revealCut } from "./reveal";

/** One reply's reveal: the text it is heading for, and how much of it is out. */
interface Reveal {
  cut: number;
  id: string;
  isStreaming: boolean;
  state: RevealState;
  text: string;
}

type TickListener = (dtMs: number) => void;

/** A step longer than this is a frame the page missed (a hidden tab, a stall), not time to catch up on. */
const MAX_TICK_MS = 50;

/**
 * The one clock the transcript's motion runs on, and the reveals it drives.
 *
 * Every reply streaming in advances on the same frame, by the same step, so
 * nothing on the page moves to a timer of its own. The clock runs only while
 * something is listening, and its time is the stage's own: `rate` slows or
 * stops it (the debug page's slow motion and pause), and `step` moves it by a
 * fixed amount by hand.
 */
export class Stage {
  private readonly reveals = new Map<string, Reveal>();
  /** Kept apart from the reveals, so a reveal made again keeps who listens. */
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly tickListeners = new Set<TickListener>();
  private frame = 0;
  private lastFrameAt: number | undefined;
  private rate = 1;
  /** Elapsed stage time, in ms: real time, scaled by the rate. */
  private time = 0;

  /** Elapsed stage time, in ms. */
  now(): number {
    return this.time;
  }

  getRate(): number {
    return this.rate;
  }

  /** How fast the stage runs: 1 is real time, 0 stops it. */
  setRate(rate: number) {
    this.rate = Math.max(0, rate);
  }

  /** Moves the stage on by `ms` at once, as one tick. */
  step(ms: number) {
    this.tick(ms);
  }

  /** Called on every tick with the stage time that passed. */
  onTick(listener: TickListener): () => void {
    this.tickListeners.add(listener);
    this.wake();
    return () => {
      this.tickListeners.delete(listener);
    };
  }

  // -- reveals ----------------------------------------------------------------

  /**
   * Points a reply's reveal at its text as it now stands. A reply first seen
   * whole, or first seen when it is already finished, shows whole: only words
   * arriving while it is on screen are paced.
   */
  setTarget(id: string, text: string, isStreaming: boolean) {
    const reveal = this.reveals.get(id);
    if (!reveal) {
      const length = text.length;
      this.reveals.set(id, {
        cut: revealCut(text, length, isStreaming),
        id,
        isStreaming,
        state: { shown: length, velocity: 0 },
        text,
      });
      return;
    }
    if (!text.startsWith(reveal.text.slice(0, reveal.cut))) {
      // The text was rewritten under what is out: start again from what
      // still matches, rather than show words that are gone.
      let same = 0;
      while (same < reveal.cut && text[same] === reveal.text[same]) {
        same += 1;
      }
      reveal.state = { ...reveal.state, shown: same };
      reveal.cut = Math.min(reveal.cut, same);
    }
    reveal.text = text;
    reveal.isStreaming = isStreaming;
    // Read in the same render that set it, so nothing needs telling.
    this.recut(reveal, false);
    this.wake();
  }

  /** How many characters of the reply to draw. */
  cutOf(id: string): number | undefined {
    return this.reveals.get(id)?.cut;
  }

  /** Whether the reply still has words on their way out. */
  isRevealing(id: string): boolean {
    const reveal = this.reveals.get(id);
    return reveal
      ? reveal.isStreaming || reveal.cut < reveal.text.length
      : false;
  }

  /**
   * Listens for the reply's cut changing. Once nobody listens, the reveal is
   * forgotten, a task later so a listener leaving and coming straight back (a
   * remount in place) keeps it.
   */
  subscribeReveal(id: string, listener: () => void): () => void {
    let listeners = this.listeners.get(id);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(id, listeners);
    }
    const own = listeners;
    own.add(listener);
    return () => {
      own.delete(listener);
      queueMicrotask(() => {
        if (own.size === 0 && this.listeners.get(id) === own) {
          this.listeners.delete(id);
          this.reveals.delete(id);
        }
      });
    };
  }

  /**
   * Shows every reply as far as its text goes, for a jump in time the reveal
   * could not have kept up with (the debug page seeking).
   */
  catchUp() {
    for (const reveal of this.reveals.values()) {
      reveal.state = { shown: reveal.text.length, velocity: 0 };
      this.recut(reveal);
    }
  }

  // -- the clock --------------------------------------------------------------

  private wake() {
    if (this.frame || !this.hasWork()) {
      return;
    }
    this.frame = requestAnimationFrame(this.onFrame);
  }

  private hasWork(): boolean {
    if (this.tickListeners.size > 0) {
      return true;
    }
    for (const reveal of this.reveals.values()) {
      if (reveal.state.shown < reveal.text.length) {
        return true;
      }
    }
    return false;
  }

  private readonly onFrame = (at: number) => {
    this.frame = 0;
    const real =
      this.lastFrameAt === undefined
        ? 0
        : Math.min(at - this.lastFrameAt, MAX_TICK_MS);
    this.lastFrameAt = at;
    this.tick(real * this.rate);
    if (this.hasWork()) {
      this.frame = requestAnimationFrame(this.onFrame);
    } else {
      this.lastFrameAt = undefined;
    }
  };

  private tick(dtMs: number) {
    if (dtMs <= 0) {
      return;
    }
    this.time += dtMs;
    for (const reveal of this.reveals.values()) {
      if (reveal.state.shown >= reveal.text.length) {
        continue;
      }
      reveal.state = advance(
        reveal.state,
        reveal.text.length,
        dtMs,
        reveal.isStreaming,
      );
      this.recut(reveal);
    }
    for (const listener of this.tickListeners) {
      listener(dtMs);
    }
  }

  /** Recomputes what to draw, and tells the reply only when that changed. */
  private recut(reveal: Reveal, notifies = true) {
    const next = revealCut(
      reveal.text,
      Math.floor(reveal.state.shown),
      reveal.isStreaming,
    );
    // Never back: a cut that would take words away keeps the ones already out,
    // unless the text under them changed.
    const cut =
      next < reveal.cut && reveal.cut <= reveal.text.length ? reveal.cut : next;
    if (cut === reveal.cut) {
      return;
    }
    reveal.cut = cut;
    if (!notifies) {
      return;
    }
    for (const listener of this.listeners.get(reveal.id) ?? []) {
      listener();
    }
  }
}

/** The stage every transcript in the window shares. */
export const stage = new Stage();
