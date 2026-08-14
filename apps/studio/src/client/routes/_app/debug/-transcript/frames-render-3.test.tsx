import { describe, expect, it, vi } from "vitest";

import { drawEveryFrame, SHARD_COUNT } from "./frames-render";

// A diagram asks the app which theme to draw against, and the real provider
// resolves that through `matchMedia` and an RPC round trip -- neither of which
// exists here, and neither of which any rule in the sweep reads. Spelled out in
// each shard file because `vi.mock` is hoisted above the imports and so cannot
// reach a factory defined anywhere else.
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
    theme: "light",
  }),
}));

describe(`the scenario library, drawn frame by frame (shard 3 of ${SHARD_COUNT.toString()})`, () => {
  it("holds every rule in every frame", () => {
    const { broke, drawn, scenarioCount } = drawEveryFrame(2);

    // A shard that drew nothing would hold every rule vacuously, and so would
    // one whose scenarios all built an empty script.
    expect(scenarioCount).toBeGreaterThan(0);
    expect(drawn).toBeGreaterThan(scenarioCount);
    expect(broke).toEqual({ empty: [], indented: [], live: [] });
  }, 120_000);
});
