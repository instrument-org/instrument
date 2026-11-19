import { type RevealState, advance, revealCut } from "./reveal";

/** One reply's reveal: the text it is heading for, and how much of it is out. */
interface Reveal {
  cut: number;
  id: string;
  isStreaming: boolean;
  state: RevealState;
  text: string;
  /** Held behind a row still settling or words still coming out above it: it does not move until it shows. */
  waits: boolean;
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
  /** Holds still running, by key, with the stage time each has left. */
  private readonly holds = new Map<string, number>();
  private frame = 0;
  private lastFrameAt: number | undefined;
  private rate = 1;
  /** Elapsed stage time, in ms: real time, scaled by the rate. */
  private time = 0;
  /** When the clock last stopped for want of work, in real time: its time still passes. */
  private idleSince: number | undefined;

  /** Elapsed stage time, in ms, counting the time it stood idle at its rate. */
  now(): number {
    return this.idleSince === undefined
      ? this.time
      : this.time + (performance.now() - this.idleSince) * this.rate;
  }

  getRate(): number {
    return this.rate;
  }

  /** How fast the stage runs: 1 is real time, 0 stops it. */
  setRate(rate: number) {
    this.settleIdle();
    this.rate = Math.max(0, rate);
    this.wake();
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
   * on screen shows whole as far as it goes: only words arriving while it is
   * on screen are paced. One first seen while it `waits` behind the work
   * above it is new, so it starts from nothing, and stays there until it shows.
   */
  setTarget(id: string, text: string, isStreaming: boolean, waits = false) {
    const reveal = this.reveals.get(id);
    if (!reveal) {
      const shown = waits ? 0 : text.length;
      this.reveals.set(id, {
        cut: revealCut(text, shown, isStreaming),
        id,
        isStreaming,
        state: { shown, velocity: 0 },
        text,
        waits,
      });
      return;
    }
    reveal.waits = waits;
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
    // The reply reads it in the render that set it; anyone else watching (the
    // rows held behind it) hears once that render is done.
    const before = reveal.cut;
    this.recut(reveal, false);
    if (reveal.cut !== before) {
      queueMicrotask(() => {
        this.notify(id);
      });
    }
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
   * Holds `key` for `ms` of stage time, telling its listeners when it lets go:
   * how a row still settling keeps what comes after it back until it is still.
   */
  hold(key: string, ms: number) {
    if (ms <= 0) {
      return;
    }
    this.holds.set(key, Math.max(this.holds.get(key) ?? 0, ms));
    this.wake();
  }

  /** Whether `key` is held now. */
  isHeld(key: string): boolean {
    return this.holds.has(key);
  }

  /**
   * Shows every reply as far as its text goes, and lets every hold go, for a
   * jump in time the reveal could not have kept up with (the debug page
   * seeking).
   */
  catchUp() {
    for (const reveal of this.reveals.values()) {
      reveal.state = { shown: reveal.text.length, velocity: 0 };
      this.recut(reveal);
    }
    const held = [...this.holds.keys()];
    this.holds.clear();
    for (const key of held) {
      this.notify(key);
    }
  }

  // -- the clock --------------------------------------------------------------

  /** Takes the idle time into the clock, at the rate it passed at. */
  private settleIdle() {
    if (this.idleSince !== undefined) {
      const at = performance.now();
      this.time += (at - this.idleSince) * this.rate;
      this.idleSince = at;
    }
  }

  private wake() {
    if (this.frame || !this.hasWork()) {
      return;
    }
    this.settleIdle();
    this.idleSince = undefined;
    this.frame = requestAnimationFrame(this.onFrame);
  }

  private hasWork(): boolean {
    // Stopped, nothing moves on: it wakes again when the rate does.
    if (this.rate === 0) {
      return false;
    }
    if (this.tickListeners.size > 0 || this.holds.size > 0) {
      return true;
    }
    for (const reveal of this.reveals.values()) {
      if (!reveal.waits && reveal.state.shown < reveal.text.length) {
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
      this.idleSince = performance.now();
    }
  };

  private tick(dtMs: number) {
    if (dtMs <= 0) {
      return;
    }
    this.time += dtMs;
    for (const [key, left] of this.holds) {
      if (left > dtMs) {
        this.holds.set(key, left - dtMs);
      } else {
        this.holds.delete(key);
        this.notify(key);
      }
    }
    for (const reveal of this.reveals.values()) {
      if (reveal.waits || reveal.state.shown >= reveal.text.length) {
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
    if (notifies) {
      this.notify(reveal.id);
    }
  }

  private notify(id: string) {
    for (const listener of this.listeners.get(id) ?? []) {
      listener();
    }
  }
}

/** The stage every transcript in the window shares. */
export const stage = new Stage();
