import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  calls: [] as unknown[],
  complete: vi.fn(),
  pending: new Map<string, string>(),
}));

vi.mock("@/electron-main/lib/directory-icons", () => ({
  directoryIconDataUri: vi.fn(),
  iconDataUri: vi.fn(),
}));
vi.mock("@/electron-main/stores/workspace/app-connections", () => ({
  appConnectionStore: { get: () => Promise.resolve(undefined) },
}));
vi.mock("@/electron-main/stores/workspace/app-credentials", () => ({}));
vi.mock("@/electron-main/stores/workspace/app-oauth", () => ({}));
vi.mock("@/electron-main/browser-view/history-intents", () => ({
  settleSignIn: (slug: string) => mocks.calls.push(["settleSignIn", slug]),
}));
vi.mock("@/electron-main/lib/app-connection", () => ({
  settleConnection: (slug: string, outcome: unknown) => {
    mocks.calls.push(["settleConnection", slug, outcome]);
    return Promise.resolve();
  },
}));
vi.mock("@instrument-org/workspace/electron", () => ({
  appChanged: (slug: string, happened: unknown) => {
    mocks.calls.push(["appChanged", slug, happened]);
    return Promise.resolve();
  },
  cancelMcpOAuth: (state: string) => {
    mocks.calls.push(["cancelMcpOAuth", state]);
    return Promise.resolve();
  },
  completeMcpOAuth: mocks.complete,
  pendingMcpOAuthSlug: (state: string) => mocks.pending.get(state),
}));

import { receiveAppCallback, rememberAppsDir } from "./apps";

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.pending = new Map([["waiting", "linear"]]);
  mocks.complete.mockResolvedValue({
    isErr: () => false,
    value: { opensIn: "app", slug: "linear" },
  });
  // Branded as the workspace brands it, whose schemas are mocked away here.
  rememberAppsDir(z.string().brand("AbsolutePath").parse("/apps"));
});

describe("receiveAppCallback", () => {
  it("settles each way the browser can come back", async () => {
    const settled: Record<string, unknown> = {};
    for (const [name, query] of [
      ["a denial", "state=waiting&error=access_denied"],
      ["an abandoned sign-in", "state=waiting"],
      ["a denial nobody waits on", "state=gone&error=access_denied"],
      ["no state", "code=code"],
      ["a code", "state=waiting&code=code"],
    ] as const) {
      mocks.calls.length = 0;
      const outcome = await receiveAppCallback(new URLSearchParams(query));
      settled[name] = { calls: [...mocks.calls], outcome };
    }
    expect(settled).toMatchInlineSnapshot(`
      {
        "a code": {
          "calls": [
            [
              "settleSignIn",
              "linear",
            ],
            [
              "appChanged",
              "linear",
              {
                "event": "connected",
              },
            ],
          ],
          "outcome": {
            "opensIn": "app",
            "outcome": "connected",
            "slug": "linear",
          },
        },
        "a denial": {
          "calls": [
            [
              "settleSignIn",
              "linear",
            ],
            [
              "cancelMcpOAuth",
              "waiting",
            ],
            [
              "settleConnection",
              "linear",
              {
                "status": "declined",
              },
            ],
          ],
          "outcome": {
            "outcome": "declined",
            "slug": "linear",
          },
        },
        "a denial nobody waits on": {
          "calls": [
            [
              "cancelMcpOAuth",
              "gone",
            ],
          ],
          "outcome": {
            "outcome": "expired",
          },
        },
        "an abandoned sign-in": {
          "calls": [
            [
              "settleSignIn",
              "linear",
            ],
            [
              "cancelMcpOAuth",
              "waiting",
            ],
            [
              "settleConnection",
              "linear",
              {
                "status": "declined",
              },
            ],
          ],
          "outcome": {
            "outcome": "declined",
            "slug": "linear",
          },
        },
        "no state": {
          "calls": [],
          "outcome": {
            "outcome": "expired",
          },
        },
      }
    `);
  });

  it("records a sign-in that failed to finish", async () => {
    mocks.complete.mockResolvedValue({
      error: { message: "token refused" },
      isErr: () => true,
    });
    const outcome = await receiveAppCallback(
      new URLSearchParams("state=waiting&code=code"),
    );
    expect({ calls: mocks.calls, outcome }).toMatchInlineSnapshot(`
      {
        "calls": [
          [
            "settleSignIn",
            "linear",
          ],
          [
            "settleConnection",
            "linear",
            {
              "error": "token refused",
              "status": "failed",
            },
          ],
        ],
        "outcome": {
          "error": "token refused",
          "outcome": "failed",
          "slug": "linear",
        },
      }
    `);
  });
});
