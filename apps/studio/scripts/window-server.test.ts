import { describe, expect, it } from "vitest";

import { windowServerRestarts } from "./window-server.ts";

describe("windowServerRestarts", () => {
  it.each([
    { readings: ["728", "728", "728"], restarts: [false, false, false] },
    { readings: ["728", "55216", "55216"], restarts: [false, true, false] },
    {
      readings: ["728", undefined, "55216"],
      restarts: [false, false, true],
    },
    { readings: [undefined, "728", "728"], restarts: [false, false, false] },
    { readings: ["728", "728,900"], restarts: [false, true] },
  ])("reads $readings as $restarts", ({ readings, restarts }) => {
    const restarted = windowServerRestarts();
    expect(readings.map((pids) => restarted(pids))).toEqual(restarts);
  });
});
