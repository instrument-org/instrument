import { type CaptureMeta } from "@/shared/captures";
import { describe, expect, it } from "vitest";

import { stampLine } from "./capture-stamp";

const meta = (
  build: CaptureMeta["build"],
  chatTitle?: string,
): CaptureMeta => ({
  build,
  ...(chatTitle && { chatTitle }),
  elements: [],
  os: { arch: "arm64", platform: "darwin", release: "27.0" },
  screen: "Chat",
  takenAt: new Date(2026, 10, 10, 12, 15).getTime(),
  theme: "dark",
  window: { height: 840, width: 1240 },
  zoom: 1,
});

const dev = meta(
  {
    branch: "feedback-captures",
    commit: "1b767fa",
    env: "development",
    name: "feedback-captures",
    version: "2.0.0",
  },
  "hi",
);
const production = meta({ env: "production", version: "2.0.0-beta.133" }, "hi");

describe("stampLine", () => {
  it.each([
    [
      "a wide development capture",
      dev,
      true,
      "Instrument 2.0.0 dev · feedback-captures 1b767fa · Chat “hi” · Nov 10, 12:15 PM",
    ],
    ["a narrow development capture", dev, false, "2.0.0 dev · 1b767fa"],
    [
      "a wide production capture",
      production,
      true,
      "Instrument 2.0.0-beta.133 · Chat “hi” · Nov 10, 12:15 PM",
    ],
    ["a narrow production capture", production, false, "2.0.0-beta.133"],
  ])("names the build for %s", (_, capture, wide, line) => {
    expect(stampLine(capture, wide)).toBe(line);
  });
});
