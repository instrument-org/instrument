import { renderWithProviders } from "@/tests/render";
import { type GuestCapture } from "@/shared/browser";
import { browserTargetOf, StoreId } from "@instrument-org/workspace/client";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { PageCaptureMark } from "./page-capture-mark";

const TARGET = browserTargetOf(StoreId.newTabId());

const captures = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/client/rpc/client", () => {
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: async () => (path.at(-2) === "askSystemForCapture" ? null : []),
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({
            queryFn: async () => captures.current,
            queryKey: path,
          });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({
            mutationFn: async () => null,
            ...options,
          });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

const CAMERAS = [
  { deviceId: "built-in", groupId: "a", kind: "videoinput", label: "Built-in" },
  { deviceId: "desk", groupId: "b", kind: "videoinput", label: "Desk" },
];

const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
  const { video } = constraints;
  const deviceId =
    typeof video === "object" &&
    typeof video.deviceId === "object" &&
    "exact" in video.deviceId
      ? video.deviceId.exact
      : "built-in";
  const track = {
    getSettings: () => ({ deviceId }),
    kind: "video",
    stop: () => undefined,
  };
  return { getAudioTracks: () => [], getTracks: () => [track] };
});

beforeEach(() => {
  vi.stubGlobal("MediaStream", class {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: async () => CAMERAS, getUserMedia },
  });
});

function ask(devices: GuestCapture["devices"]): GuestCapture {
  return {
    ask: { audio: false, video: true },
    blocked: null,
    devices,
    origin: "https://call.example",
    pausable: true,
    paused: false,
    refused: null,
    settings: { audio: "ask", video: "ask" },
    site: "call.example",
    system: null,
    targetId: TARGET,
    using: { audio: false, video: false },
  };
}

async function preview(devices: GuestCapture["devices"]) {
  captures.current = [ask(devices)];
  renderWithProviders(<PageCaptureMark targetId={TARGET} />);
  await screen.findByText(/Use your camera on call.example/);
  await waitFor(() => {
    expect(getUserMedia).toHaveBeenCalled();
  });
  // Anything the first preview sets off has gone by then.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return getUserMedia.mock.calls.map(([{ video }]) => video);
}

it("opens the camera once for a site with none of its own", async () => {
  expect(await preview({})).toEqual([true]);
});

it("opens the camera once when the site's is the one the system gave", async () => {
  expect(await preview({ video: "Built-in" })).toEqual([true]);
});

it("goes to the site's own camera", async () => {
  expect(await preview({ video: "Desk" })).toEqual([
    true,
    { deviceId: { exact: "desk" } },
  ]);
});
