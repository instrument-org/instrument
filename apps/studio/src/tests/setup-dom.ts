import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Loaded only by the `dom` project (see `vitest.config.ts`), on top of the
// shared node setup.

// Unmounts anything still rendered, so one test's tree cannot be found by the
// next one's queries.
afterEach(cleanup);

// The preload bridge every `isMacOS()`-style check reads. Pinned to darwin so a
// component that renders a chord (or any other per-platform copy) reads the
// same on every machine the suite runs on, rather than following the host.
Object.defineProperty(window, "electron", {
  configurable: true,
  value: { process: { platform: "darwin" } },
});
