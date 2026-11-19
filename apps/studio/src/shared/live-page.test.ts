import vm from "node:vm";
import { describe, expect, it } from "vitest";

import { easeStep, followStep } from "./live-page";

const FRAME_MS = 1000 / 60;

/**
 * What a function answers when run from its own source alone, where nothing
 * but the language's built-ins exists, as the frame's script runs it.
 */
const fromItsSource = (
  run: (...numbers: number[]) => unknown,
  numbers: number[],
): unknown =>
  JSON.parse(
    String(
      vm.runInNewContext(
        `JSON.stringify((${run.toString()})(${numbers.join(", ")}))`,
      ),
    ),
  );

/**
 * A scroll following a page's foot frame by frame, the foot jumping by
 * `jump` every `everyMs` until `untilMs`, then held there: a page written in
 * chunks. Answers the scroll at each frame.
 */
function follow({
  everyMs,
  jump,
  untilMs,
}: {
  everyMs: number;
  jump: number;
  untilMs: number;
}) {
  const positions: number[] = [];
  let at = 0;
  let velocity = 0;
  for (let now = 0; now < untilMs + 3000; now += FRAME_MS) {
    const target = Math.floor(Math.min(now, untilMs) / everyMs) * jump;
    [at, velocity] = followStep(at, velocity, target, FRAME_MS);
    positions.push(at);
  }
  return positions;
}

const steps = (positions: number[]) =>
  positions.slice(1).map((at, index) => at - (positions[index] ?? 0));

describe("following a page's foot", () => {
  it("never moves back while the page grows, and comes to the foot", () => {
    const positions = follow({ everyMs: 100, jump: 40, untilMs: 4000 });
    expect(Math.min(...steps(positions))).toBeGreaterThanOrEqual(0);
    // Within a hair, where the frame lands it.
    expect(positions.at(-1)).toBeCloseTo(1600, 2);
  });

  it("glides through writes landing in steps rather than jumping with them", () => {
    const moves = steps(follow({ everyMs: 100, jump: 40, untilMs: 4000 }));
    // A jump of 40 every 100 ms is 400 px a second, under 7 a frame.
    expect(Math.max(...moves)).toBeLessThan(10);
    // Mid-write, no frame stands still between the steps.
    const writing = moves.slice(60, 220);
    expect(Math.min(...writing)).toBeGreaterThan(3);
  });

  it("never passes its target", () => {
    let at = 0;
    let velocity = 2;
    for (let frame = 0; frame < 120; frame++) {
      [at, velocity] = followStep(at, velocity, 50, FRAME_MS);
      expect(at).toBeLessThanOrEqual(50);
    }
    expect([at, velocity]).toEqual([50, 0]);
  });

  it("moves a late frame no further than one at 15 a second", () => {
    expect(followStep(0, 0, 1000, 5000)).toEqual(followStep(0, 0, 1000, 64));
  });

  it("runs from its own source, which is how the frame runs it", () => {
    expect(fromItsSource(followStep, [0, 0, 300, FRAME_MS])).toEqual(
      followStep(0, 0, 300, FRAME_MS),
    );
  });
});

describe("easing to a place", () => {
  it.each([
    [0, 400],
    [200, 200],
    [400, 0],
    [600, 0],
  ])("after %i of 400 ms, from 400 to 0, stands at %i", (elapsed, at) => {
    expect(easeStep(400, 0, elapsed, 400)).toBe(at);
  });

  it("moves one way, slow at both ends", () => {
    const positions = Array.from({ length: 25 }, (_, frame) =>
      easeStep(400, 0, frame * FRAME_MS, 400),
    );
    const moves = steps(positions);
    expect(Math.max(...moves)).toBeLessThanOrEqual(0);
    expect(Math.abs(moves[0] ?? 0)).toBeLessThan(Math.abs(moves[11] ?? 0));
    expect(Math.abs(moves.at(-1) ?? 0)).toBeLessThan(Math.abs(moves[11] ?? 0));
  });

  it("lands at once with no time to ease", () => {
    expect(easeStep(400, 0, 0, 0)).toBe(0);
  });

  it("runs from its own source", () => {
    expect(fromItsSource(easeStep, [400, 0, 100, 400])).toBe(
      easeStep(400, 0, 100, 400),
    );
  });
});
