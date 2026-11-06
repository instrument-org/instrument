import { describe, expect, it } from "vitest";

import {
  WORKING_MARK_PIECES,
  workingMarkAt,
  workingMarkKeyframes,
  workingMarkLoopTime,
  workingMarkSteps,
} from "./working-mark-motion";

const parts = (transform: unknown) => {
  const found =
    /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)/.exec(
      String(transform),
    );
  const [x, y, scale] = (found?.slice(1) ?? []).map(Number);
  return { scale: scale ?? Number.NaN, x: x ?? Number.NaN, y: y ?? Number.NaN };
};

describe("the working mark's run", () => {
  it("opens with the seeded run's steps", () => {
    const opening = workingMarkSteps()
      .slice(0, 7)
      .map((step) => {
        const at = step.t.toFixed(2);
        switch (step.kind) {
          case "breathe": {
            return `breathe ${at} (${step.count.toString()} breaths${step.lastIsDeep ? ", last deep" : ""})`;
          }
          case "nod": {
            return `nod ${at} (${step.nods.toString()})`;
          }
          default: {
            return `${step.kind} ${at}`;
          }
        }
      });

    expect(opening).toMatchInlineSnapshot(`
      [
        "breathe 0.00 (3 breaths, last deep)",
        "split 4.50",
        "nod 5.05 (3)",
        "circle 7.45",
        "merge 8.60",
        "breathe 8.95 (2 breaths, last deep)",
        "split 11.60",
      ]
    `);
  });

  it("loops at a split, with the dots together and at rest as at the start", () => {
    const loopTime = workingMarkLoopTime();
    const first = workingMarkAt(0);
    const last = workingMarkAt(loopTime - 1 / 60);

    expect(loopTime).toBeCloseTo(117.4);
    expect(workingMarkSteps().find((step) => step.t === loopTime)?.kind).toBe(
      "split",
    );
    for (const pose of [first, last]) {
      for (const [x, y] of [pose.left, pose.right]) {
        expect(x).toBeCloseTo(8);
        expect(y).toBeCloseTo(8);
      }
    }
    expect(Math.abs(last.radius - first.radius)).toBeLessThan(0.01);
    // A ring at the very end of its life, against the next one starting hidden
    // behind the dot at the dot's own size.
    expect(last.ring?.opacity ?? 0).toBeLessThan(0.01);
    expect(first.ring?.radius).toBe(first.radius);
    expect(first.bloom).toBeUndefined();
    expect(first.echo).toBeUndefined();
  });

  it("draws every piece from one middle whenever the dot is single", () => {
    const keyframes = workingMarkKeyframes();
    for (const { kind, name, radius } of WORKING_MARK_PIECES) {
      if (kind !== "dot") {
        for (const { transform } of keyframes[name]) {
          const { scale, x, y } = parts(transform);
          expect(Math.abs(x + radius * scale)).toBeLessThan(0.01);
          expect(Math.abs(y + radius * scale)).toBeLessThan(0.01);
        }
      }
    }
    // A breath's peak, a deep one's, and well after a merge.
    for (const t of [0.75, 3.75, 10.85]) {
      const { left, right } = workingMarkAt(t);
      expect(left).toEqual([expect.closeTo(8), expect.closeTo(8)]);
      expect(right).toEqual([expect.closeTo(8), expect.closeTo(8)]);
    }
  });

  it("thins the frames to lines that stay close to every one of them", () => {
    const loopTime = workingMarkLoopTime();
    for (const { name, radius } of WORKING_MARK_PIECES) {
      const frames = workingMarkKeyframes()[name];
      expect(frames[0]?.offset).toBe(0);
      expect(frames.at(-1)?.offset).toBe(1);
      let at = 0;
      for (let frame = 0; frame < Math.round(loopTime * 60); frame++) {
        const t = frame / 60;
        const offset = t / loopTime;
        while ((frames[at + 1]?.offset ?? 2) <= offset) {
          at++;
        }
        const from = frames[at];
        const to = frames[at + 1];
        const along =
          (offset - (from?.offset ?? 0)) /
            ((to?.offset ?? 1) - (from?.offset ?? 0)) || 0;
        const start = parts(from?.transform);
        const end = parts(to?.transform);
        const scale = start.scale + (end.scale - start.scale) * along;
        const pose = workingMarkAt(t);
        const wanted =
          name === "left" || name === "right"
            ? pose.radius
            : (pose[name]?.radius ?? 5);
        expect(Math.abs(scale * radius - wanted)).toBeLessThan(0.06);
      }
    }
  });
});
