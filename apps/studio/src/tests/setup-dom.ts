import { resetStudioModals } from "@/client/atoms/studio-modal";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Loaded only by the `dom` project (see `vitest.config.ts`), on top of the
// shared node setup.

// Unmounts anything still rendered, so one test's tree cannot be found by the
// next one's queries.
afterEach(cleanup);

// The app-wide modal slot lives on the default store, which no `cleanup` can
// reach: a test that opened a modal would otherwise leave it open for the next
// one, where it reads as a modal already blocking.
afterEach(resetStudioModals);

// The preload bridge every `isMacOS()`-style check reads. Pinned to darwin so a
// component that renders a chord (or any other per-platform copy) reads the
// same on every machine the suite runs on, rather than following the host.
Object.defineProperty(window, "electron", {
  configurable: true,
  value: { process: { platform: "darwin" } },
});
