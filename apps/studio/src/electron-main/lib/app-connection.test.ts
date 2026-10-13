import { type AppConnection } from "@instrument-org/workspace/electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ConnectionOutcome,
  settleConnection,
  standingOf,
} from "./app-connection";

const mocks = vi.hoisted(() => ({
  calls: [] as unknown[],
}));

vi.mock("@instrument-org/workspace/electron", () => ({
  appChanged: (...args: unknown[]) => {
    mocks.calls.push(["appChanged", ...args]);
    return Promise.resolve();
  },
  recordConnection: (...args: unknown[]) => {
    mocks.calls.push(["recordConnection", ...args]);
    return Promise.resolve();
  },
}));

beforeEach(() => {
  mocks.calls.length = 0;
  vi.useFakeTimers({ now: 1000 });
});

function connection(patch: Partial<AppConnection>): AppConnection {
  return { status: "connected", updatedAt: 0, ...patch };
}

const RECORDS: [string, AppConnection | undefined][] = [
  ["no record", undefined],
  ["connected on this manifest", connection({ manifestHash: "now" })],
  ["connected on another manifest", connection({ manifestHash: "before" })],
  ["connected with no manifest", connection({})],
  ["declined", connection({ status: "declined" })],
  ["failed", connection({ status: "failed" })],
  ["needs approval", connection({ status: "needs-approval" })],
  ["needs a key", connection({ status: "needs-key" })],
  ["needs a sign-in", connection({ status: "needs-sign-in" })],
];

const OUTCOMES: ConnectionOutcome[] = [
  { manifestHash: "now", status: "connected" },
  { status: "declined" },
  { error: "no client", status: "failed" },
  { approvedManifestHash: "now", status: "needs-approval" },
  { error: "refused", status: "needs-key" },
  { error: "expired", status: "needs-sign-in" },
];

describe("standingOf", () => {
  it("reads a record against the manifest as it is now", () => {
    expect(
      Object.fromEntries(
        RECORDS.map(([name, record]) => [name, standingOf(record, "now")]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "connected on another manifest": "stale",
        "connected on this manifest": "connected",
        "connected with no manifest": "stale",
        "declined": "declined",
        "failed": "failed",
        "needs a key": "needs-key",
        "needs a sign-in": "needs-sign-in",
        "needs approval": "needs-approval",
        "no record": "untested",
      }
    `);
  });
});

describe("settleConnection", () => {
  it("records each outcome and tells the chat only of the user's doing", async () => {
    const settled: Record<string, unknown[]> = {};
    for (const outcome of OUTCOMES) {
      mocks.calls.length = 0;
      await settleConnection("linear", outcome);
      settled[outcome.status] = [...mocks.calls];
    }
    expect(settled).toMatchInlineSnapshot(`
      {
        "connected": [
          [
            "recordConnection",
            "linear",
            {
              "connectedAt": 1000,
              "error": undefined,
              "manifestHash": "now",
              "status": "connected",
            },
          ],
          [
            "appChanged",
            "linear",
            {
              "event": "connected",
            },
          ],
        ],
        "declined": [
          [
            "recordConnection",
            "linear",
            {
              "status": "declined",
            },
          ],
          [
            "appChanged",
            "linear",
            {
              "event": "declined",
            },
          ],
        ],
        "failed": [
          [
            "recordConnection",
            "linear",
            {
              "error": "no client",
              "status": "failed",
            },
          ],
          [
            "appChanged",
            "linear",
            {
              "detail": "no client",
              "event": "failed",
            },
          ],
        ],
        "needs-approval": [
          [
            "recordConnection",
            "linear",
            {
              "approvedManifestHash": "now",
              "status": "needs-approval",
            },
          ],
        ],
        "needs-key": [
          [
            "recordConnection",
            "linear",
            {
              "error": "refused",
              "status": "needs-key",
            },
          ],
        ],
        "needs-sign-in": [
          [
            "recordConnection",
            "linear",
            {
              "error": "expired",
              "status": "needs-sign-in",
            },
          ],
        ],
      }
    `);
  });
});
