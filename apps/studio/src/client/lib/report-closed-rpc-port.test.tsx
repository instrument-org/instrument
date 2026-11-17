import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.fn();
const preferences = { sendErrorReportsAutomatically: true };

vi.mock("@/client/rpc/client", () => ({
  CLOSED_PORT_TO_REPORT_KEY: "rpc.closedPortToReport",
  rpcClient: {
    preferences: { get: { call: () => Promise.resolve(preferences) } },
    problems: { send: { call: sent } },
  },
}));
vi.mock("@/client/lib/problem-reports", async (actual) => ({
  ...(await actual<typeof import("@/client/lib/problem-reports")>()),
  describeReport: () =>
    Promise.resolve({ details: "details", events: [], fingerprint: "error:f" }),
}));
vi.mock("./capture-exception", () => ({ captureException: vi.fn() }));

const { reportClosedRPCPort } = await import("./report-closed-rpc-port");

// The page whose RPC port closed can send nothing over it, so the page that
// loads after it reports it, once.
describe("reportClosedRPCPort", () => {
  beforeEach(() => {
    sent.mockReset();
    sessionStorage.clear();
    preferences.sendErrorReportsAutomatically = true;
  });

  it("sends a report once after a reload for a closed port", async () => {
    sessionStorage.setItem("rpc.closedPortToReport", "1");
    await reportClosedRPCPort();
    await reportClosedRPCPort();
    expect(sent.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "report": {
              "automatic": true,
              "details": "details",
              "events": [],
              "fingerprint": "error:f",
              "kind": "error",
              "surface": "window-error",
              "title": "Error: The window's RPC port closed under it; the window reloaded",
            },
          },
        ],
      ]
    `);
  });

  it("sends nothing on an ordinary load", async () => {
    await reportClosedRPCPort();
    expect(sent).not.toHaveBeenCalled();
  });

  it("sends nothing when reports don't go automatically", async () => {
    preferences.sendErrorReportsAutomatically = false;
    sessionStorage.setItem("rpc.closedPortToReport", "1");
    await reportClosedRPCPort();
    expect(sent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("rpc.closedPortToReport")).toBeNull();
  });
});
