import { mapValues, once } from "radashi";

/**
 * The working mark's motion. One dot breathes, with a ring each breath; a deep
 * breath swells further, with a soft bloom behind the dot and a second, fainter
 * ring after the first. Every few breaths it splits into a pair that comes apart
 * level, nods, sometimes circles half a turn clockwise, and merges.
 *
 * The run's choices come from a seeded random number, so it is the same run every
 * time. It is worked out once, ahead of time, a frame at a time, and reduced to
 * the fewest keyframes that stay within a small tolerance of those frames, for
 * `element.animate` to play on the compositor.
 */

// Every number that shapes the motion. Times are seconds and lengths are pixels
// in the mark's 16px box.

/** Where the run's choices start. */
const SEED = 14;
/** How far ahead the run is worked out. It loops on the last split before this. */
const LENGTH = 120;
/** The frames a second the run is worked out at. */
const FPS = 60;

/** What varies from visit to visit, each picked evenly from its range. */
const BREATHS = { fewest: 2, most: 5 };
const NODS = { fewest: 2, most: 4 };
/** How likely a spell of breaths is to end on a deep one. */
const DEEP_CHANCE = 0.6;
/** How likely the pair is to circle before it merges. */
const CIRCLE_CHANCE = 0.55;

const BREATH_TIME = 1.5;
/** From the split to the first nod. */
const SPLIT_TIME = 0.55;
/** From the start of one nod to the start of the next. */
const NOD_GAP = 0.9;
/** One nod, down and back up. */
const NOD_TIME = 0.36;
/** From the start of the last nod to whatever comes next. */
const LAST_NOD_TIME = 0.6;
/** How far the right dot's nod trails the left's. */
const RIGHT_DOT_LAG = 0.1;
/** The circle's whole step: the half turn, then a moment level. */
const CIRCLE_TIME = 1.15;
/** The half turn itself. */
const TURN_TIME = 0.8;
/** From the merge starting to the next spell's step. Its first breath has begun. */
const MERGE_TIME = 0.35;
/** How quickly the dots and the glow close on where they are headed, as a time constant. */
const EASE = 0.1;

/** The middle of the box. */
const CENTER = 8;
/** A dot's radius for each unit of its size. */
const RADIUS_PER_SIZE = 1.5;
/** The size of the one dot, which makes it 10px across at rest. */
const DOT = 10 / 3;
/** The size of each dot of the pair. */
const PAIR = 1.45;
/** How far each dot of the pair sits from the middle. */
const APART = 4.4;
/** How late the dots grow into the one dot as they close in. */
const CLOSING_CURVE = 2.2;
/** How much a breath swells the dot, and how many times that a deep breath does. */
const SWELL = 0.2;
const DEEP_SWELL = 1.75;
/** The first nod's dip, how much shallower the last one is, and how fast each drops. */
const NOD_DEPTH = 2;
const NOD_FADE = 0.6;
const NOD_CURVE = 0.7;
/** How much past the resting dot the bloom's radius grows. */
const BLOOM_GROWTH = 2.4;
/** How far each ring reaches, as a multiple of the resting dot's radius. */
const RING_REACH = 2.5;
const DEEP_RING_REACH = 2.9;
const ECHO_REACH = 3.3;
/** How strong each ring starts, and how far the echo trails the ring. */
const RING_STRENGTH = 0.6;
const ECHO_STRENGTH = 0.3;
const ECHO_DELAY = 0.28;
/** The glow a ring has to be past to show at all. */
const RING_GLOW_FLOOR = 0.1;
/**
 * The ring as drawn. A scale cannot keep a stroke constant, so it is true at one
 * size: 1.5px at 2.2 times the resting dot's radius, 11px, where the ring is most
 * visible. Whole pixels, so the stroke lands on device pixels at every whole scale.
 */
const RING_DRAWN_RADIUS = 22;
export const WORKING_MARK_RING_STROKE = 3;
/** How far a thinned keyframe may stray from the frames it replaces. */
const POSITION_TOLERANCE = 0.05;
const OPACITY_TOLERANCE = 0.01;

// Every piece is drawn an even whole number of pixels across, at least as large
// as it ever gets, and only scaled down, so nothing is rastered small and blurred
// up. Each box's corner sits on the mark's middle, and its keyframes scale from
// that corner and move it back by its radius. A box's place rounds to a device
// pixel on its own, so boxes of different sizes centered by their sizes can land a
// device pixel apart, where boxes sharing a corner always round together.

const RESTING_RADIUS = RADIUS_PER_SIZE * DOT;
const DOT_DRAWN_RADIUS = Math.ceil(RESTING_RADIUS * (1 + SWELL * DEEP_SWELL));
const BLOOM_DRAWN_RADIUS = Math.ceil(RESTING_RADIUS + BLOOM_GROWTH);

/** What each piece of the mark needs drawn, in paint order. */
export const WORKING_MARK_PIECES = [
  { kind: "bloom", name: "bloom", radius: BLOOM_DRAWN_RADIUS },
  { kind: "ring", name: "ring", radius: RING_DRAWN_RADIUS },
  { kind: "ring", name: "echo", radius: RING_DRAWN_RADIUS },
  { kind: "dot", name: "left", radius: DOT_DRAWN_RADIUS },
  { kind: "dot", name: "right", radius: DOT_DRAWN_RADIUS },
] as const;

export type WorkingMarkPiece = (typeof WORKING_MARK_PIECES)[number];

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** A box scaled from its corner, with its middle `x` and `y` from the mark's middle. */
function placed(radius: number, scale: number, x = 0, y = 0) {
  const left = round(x - radius * scale, 3).toString();
  const top = round(y - radius * scale, 3).toString();
  return `translate(${left}px, ${top}px) scale(${round(scale, 4).toString()})`;
}

/** A piece as it stands with nothing playing: the dot at rest, the others gone. */
export function restingStyle(piece: WorkingMarkPiece) {
  return piece.kind === "dot"
    ? { transform: placed(piece.radius, RESTING_RADIUS / piece.radius) }
    : { opacity: 0 };
}

type Step = { t: number } & (
  | { count: number; from: number; kind: "breathe"; lastIsDeep: boolean }
  | { kind: "circle" | "merge" | "split" }
  | { kind: "nod"; nods: number }
);

type Point = [x: number, y: number];

interface Frame {
  glow: number;
  left: Point;
  right: Point;
  size: number;
}

const easeOut = (q: number) => 1 - (1 - Math.min(1, Math.max(0, q))) ** 2;
/** A quick in-and-out for the half turn: fast through the middle, landing softly. */
const snap = (q: number) => (q < 0.5 ? 8 * q ** 4 : 1 - 8 * (1 - q) ** 4);

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** The run: short spells of breathing, each followed by a quick visit from the pair. */
function buildSteps(): Step[] {
  const random = seededRandom(SEED);
  const pick = ({ fewest, most }: { fewest: number; most: number }) =>
    fewest + Math.floor(random() * (most - fewest + 1));
  const steps: Step[] = [];
  let t = 0;
  // The breath's clock starts as the pair begins to merge, so the dot is already
  // breathing as it forms.
  let from = 0;
  while (t < LENGTH) {
    const count = pick(BREATHS);
    const lastIsDeep = random() < DEEP_CHANCE;
    steps.push({ count, from, kind: "breathe", lastIsDeep, t });
    t = from + count * BREATH_TIME;
    const nods = pick(NODS);
    const circles = random() < CIRCLE_CHANCE;
    steps.push({ kind: "split", t });
    t += SPLIT_TIME;
    steps.push({ kind: "nod", nods, t });
    t += (nods - 1) * NOD_GAP + LAST_NOD_TIME;
    if (circles) {
      steps.push({ kind: "circle", t });
      t += CIRCLE_TIME;
    }
    steps.push({ kind: "merge", t });
    from = t;
    t += MERGE_TIME;
  }
  return steps;
}

/** The last step started by time t, and the one after it. */
function stepAt(steps: Step[], t: number) {
  let low = 0;
  let high = steps.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((steps[middle]?.t ?? Infinity) <= t) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const step = steps[low];
  if (!step) {
    throw new Error("The working mark's run has no steps");
  }
  return { next: steps[low + 1], step };
}

/** Where the two dots are headed at time t: together while breathing, level and apart as a pair. */
function goal(step: Step, t: number): { left: Point; right: Point } {
  if (step.kind === "breathe" || step.kind === "merge") {
    return { left: [CENTER, CENTER], right: [CENTER, CENTER] };
  }
  // Clockwise only, so the angle only ever grows, then a moment level before they meet.
  const angle =
    step.kind === "circle"
      ? Math.PI * snap(Math.min(1, (t - step.t) / TURN_TIME))
      : 0;
  const dx = APART * Math.cos(angle);
  const dy = APART * Math.sin(angle);
  return {
    left: [CENTER - dx, CENTER - dy],
    right: [CENTER + dx, CENTER + dy],
  };
}

/** The whole run ahead of time: both dots eased toward their goal, and how far into breathing the mark is. */
function buildFrames(steps: Step[]): Frame[] {
  const k = 1 - Math.exp(-1 / FPS / EASE);
  const frames: Frame[] = [];
  let left: Point = [CENTER, CENTER];
  let right: Point = [CENTER, CENTER];
  let glow = 1;
  for (let f = 0; f <= LENGTH * FPS; f++) {
    const t = f / FPS;
    const { step } = stepAt(steps, t);
    const to = goal(step, t);
    left = [
      left[0] + (to.left[0] - left[0]) * k,
      left[1] + (to.left[1] - left[1]) * k,
    ];
    right = [
      right[0] + (to.right[0] - right[0]) * k,
      right[1] + (to.right[1] - right[1]) * k,
    ];
    // The dots are pair-sized while apart and grow into the one dot only as they
    // close in, so they never swell into two big overlapping circles on the way.
    const near =
      1 -
      Math.min(
        1,
        Math.hypot(left[0] - right[0], left[1] - right[1]) / (2 * APART),
      );
    const size = PAIR + (DOT - PAIR) * near ** CLOSING_CURVE;
    glow +=
      ((step.kind === "breathe" || step.kind === "merge" ? 1 : 0) - glow) * k;
    frames.push({ glow, left, right, size });
  }
  return frames;
}

const run = once(() => {
  const steps = buildSteps();
  return { frames: buildFrames(steps), steps };
});

/** Short dips, each a little shallower, dropping fast and coming back up more gently. */
function nodLift(age: number, count: number) {
  for (let i = 0; i < count; i++) {
    const u = (age - i * NOD_GAP) / NOD_TIME;
    if (u > 0 && u < 1) {
      const depth = NOD_DEPTH - (NOD_FADE * i) / Math.max(1, count - 1);
      return depth * Math.sin(Math.PI * u ** NOD_CURVE) ** 2;
    }
  }
  return 0;
}

/** Which breath of its spell the mark is on at time t, and how far through. */
function breathAt(steps: Step[], t: number) {
  const { next, step } = stepAt(steps, t);
  // While the pair merges, the next spell's first breath has already begun.
  const spell = step.kind === "merge" ? next : step;
  if (spell?.kind !== "breathe") {
    return undefined;
  }
  const n = Math.floor((t - spell.from) / BREATH_TIME);
  return {
    deep: spell.lastIsDeep && n === spell.count - 1,
    q: (t - spell.from - n * BREATH_TIME) / BREATH_TIME,
    start: spell.from + n * BREATH_TIME,
  };
}

/** A round thing the mark draws, by its radius and opacity. */
interface Round {
  opacity: number;
  radius: number;
}

/** Everything the mark draws at time t, in the box's own pixels. */
export function workingMarkAt(t: number) {
  const { frames, steps } = run();
  const frame = frames[Math.min(frames.length - 1, Math.round(t * FPS))];
  if (!frame) {
    throw new Error("The working mark's run has no frames");
  }
  const breath = breathAt(steps, t);
  const { step } = stepAt(steps, t);
  const swell = breath
    ? SWELL * (breath.deep ? DEEP_SWELL : 1) * Math.sin(Math.PI * breath.q) ** 2
    : 0;
  const lift: Point =
    step.kind === "nod"
      ? [
          nodLift(t - step.t, step.nods),
          nodLift(t - step.t - RIGHT_DOT_LAG, step.nods),
        ]
      : [0, 0];
  const ring = (
    age: number,
    reach: number,
    strength: number,
  ): Round | undefined => {
    if (age < 0 || age > BREATH_TIME) {
      return undefined;
    }
    const q = age / BREATH_TIME;
    return {
      opacity: strength * (1 - q) * Math.max(0, frame.glow - RING_GLOW_FLOOR),
      radius: RESTING_RADIUS * (1 + (reach - 1) * easeOut(q)),
    };
  };
  return {
    bloom: breath?.deep
      ? ({
          opacity: Math.sin(Math.PI * breath.q) * frame.glow,
          radius: RESTING_RADIUS + BLOOM_GROWTH * Math.sin(Math.PI * breath.q),
        } satisfies Round)
      : undefined,
    echo: breath?.deep
      ? ring(t - breath.start - ECHO_DELAY, ECHO_REACH, ECHO_STRENGTH)
      : undefined,
    left: [frame.left[0], frame.left[1] + lift[0]] satisfies Point,
    radius: RADIUS_PER_SIZE * frame.size * (1 + swell * frame.glow),
    right: [frame.right[0], frame.right[1] + lift[1]] satisfies Point,
    ring: breath
      ? ring(
          t - breath.start,
          breath.deep ? DEEP_RING_REACH : RING_REACH,
          RING_STRENGTH,
        )
      : undefined,
  };
}

type Pose = ReturnType<typeof workingMarkAt>;

/** The run's steps, to read and to test against. */
export function workingMarkSteps() {
  return run().steps;
}

/**
 * How long the loop is, in seconds: up to the last split before the run's end.
 * The dots are together and at rest with no ring showing as the breaths end, which
 * is how the run starts.
 */
export const workingMarkLoopTime = once(() => {
  const seam = workingMarkSteps().findLast(
    (step) => step.kind === "split" && step.t <= LENGTH,
  );
  if (!seam) {
    throw new Error("The working mark's run never splits");
  }
  return seam.t;
});

/** Every frame of the loop. */
const loopPoses = once((): { pose: Pose; t: number }[] => {
  const poses = [];
  for (let f = 0; f < Math.round(workingMarkLoopTime() * FPS); f++) {
    const t = f / FPS;
    poses.push({ pose: workingMarkAt(t), t });
  }
  return poses;
});

interface Sample {
  t: number;
  values: number[];
}

/**
 * The fewest samples of a stretch that stay within `tolerance` of every sample
 * dropped, per value, as straight lines between those kept (Ramer-Douglas-Peucker
 * over time).
 */
function thin(samples: Sample[], tolerance: number[]): Sample[] {
  const kept = new Set([0, samples.length - 1]);
  const stretches: [number, number][] = [[0, samples.length - 1]];
  for (let stretch = stretches.pop(); stretch; stretch = stretches.pop()) {
    const [first, last] = stretch;
    const from = samples[first];
    const to = samples[last];
    if (!from || !to) {
      continue;
    }
    let worst = 1;
    let worstAt = -1;
    for (let i = first + 1; i < last; i++) {
      const sample = samples[i];
      const along = sample ? (sample.t - from.t) / (to.t - from.t) : 0;
      for (let index = 0; index < tolerance.length; index++) {
        const start = from.values[index] ?? 0;
        const line = start + ((to.values[index] ?? 0) - start) * along;
        const off =
          Math.abs((sample?.values[index] ?? 0) - line) /
          (tolerance[index] ?? 1);
        if (off > worst) {
          worst = off;
          worstAt = i;
        }
      }
    }
    if (worstAt >= 0) {
      kept.add(worstAt);
      stretches.push([first, worstAt], [worstAt, last]);
    }
  }
  return samples.filter((_, index) => kept.has(index));
}

/**
 * A piece's samples over the loop, thinned. The last sample holds to the loop's
 * end, and the loop starting over is a hard step. With `restarts`, a first value
 * that falls is the piece starting over within the loop, and that is a hard step
 * too rather than a line across the frame between: a ring on its way out never
 * flashes through every size on its way back to the middle.
 */
function thinnedSamples(
  sample: (pose: Pose) => number[],
  tolerance: number[],
  restarts = false,
): Sample[] {
  const kept: Sample[] = [];
  let stretch: Sample[] = [];
  const close = (t: number) => {
    const last = stretch.at(-1);
    if (last) {
      kept.push(...thin([...stretch, { t, values: last.values }], tolerance));
    }
    stretch = [];
  };
  for (const { pose, t } of loopPoses()) {
    const values = sample(pose);
    if (restarts && (values[0] ?? 0) < (stretch.at(-1)?.values[0] ?? 0)) {
      close(t);
    }
    stretch.push({ t, values });
  }
  close(workingMarkLoopTime());
  return kept;
}

/** A round thing's scale and opacity over the loop, hidden and at its smallest when it is gone. */
function roundKeyframes(
  of: (pose: Pose) => Round | undefined,
  drawn: number,
  restarts = false,
): Keyframe[] {
  const loopTime = workingMarkLoopTime();
  return thinnedSamples(
    (pose) => {
      const shape = of(pose);
      return shape
        ? [shape.radius / drawn, shape.opacity]
        : [RESTING_RADIUS / drawn, 0];
    },
    [POSITION_TOLERANCE / drawn, OPACITY_TOLERANCE],
    restarts,
  ).map(({ t, values: [scale = 1, opacity = 0] }) => ({
    offset: Math.min(1, t / loopTime),
    opacity: round(opacity, 3),
    transform: placed(drawn, scale),
  }));
}

/** A dot's place and scale over the loop. */
function dotKeyframes(side: "left" | "right"): Keyframe[] {
  const loopTime = workingMarkLoopTime();
  return thinnedSamples(
    (pose) => {
      const [x, y] = pose[side];
      return [pose.radius / DOT_DRAWN_RADIUS, x - CENTER, y - CENTER];
    },
    [
      POSITION_TOLERANCE / DOT_DRAWN_RADIUS,
      POSITION_TOLERANCE,
      POSITION_TOLERANCE,
    ],
  ).map(({ t, values: [scale = 1, x = 0, y = 0] }) => ({
    offset: Math.min(1, t / loopTime),
    transform: placed(DOT_DRAWN_RADIUS, scale, x, y),
  }));
}

/** Each piece's keyframes, worked out on first use. */
export const workingMarkKeyframes = once(
  (): Record<WorkingMarkPiece["name"], Keyframe[]> => ({
    bloom: roundKeyframes((pose) => pose.bloom, BLOOM_DRAWN_RADIUS),
    echo: roundKeyframes((pose) => pose.echo, RING_DRAWN_RADIUS, true),
    left: dotKeyframes("left"),
    right: dotKeyframes("right"),
    ring: roundKeyframes((pose) => pose.ring, RING_DRAWN_RADIUS, true),
  }),
);

/**
 * Each piece's effect, built once. A mark clones these rather than handing its
 * keyframes to `element.animate`, which would parse all of them again for every
 * mark.
 */
export const workingMarkEffects = once(() =>
  mapValues(
    workingMarkKeyframes(),
    (keyframes) =>
      new KeyframeEffect(null, keyframes, {
        duration: workingMarkLoopTime() * 1000,
        iterations: Infinity,
      }),
  ),
);
