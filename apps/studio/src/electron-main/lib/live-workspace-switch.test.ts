import { beforeEach, describe, expect, it, vi } from "vitest";

const approval = vi.hoisted(() => ({ approved: true }));
const relaunchApp = vi.hoisted(() =>
  vi.fn(() => Promise.resolve("relaunching")),
);

vi.mock("electron", () => ({ app: { isPackaged: false, quit: vi.fn() } }));
vi.mock("@/electron-main/auth/client", () => ({ cancelSignInSocial: vi.fn() }));
vi.mock("@/electron-main/platform-api/client", () => ({
  platformApiQueryClient: { clear: vi.fn() },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("@/electron-main/windows/app-window", () => ({
  closeAppWindowForSwitch: vi.fn(() => Promise.resolve()),
  openAppWindow: vi.fn(),
}));
vi.mock("./capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));
vi.mock("./claude-account", () => ({ cancelClaudeSignIn: vi.fn() }));
vi.mock("./openrouter-connect", () => ({ cancelOpenRouterConnect: vi.fn() }));
vi.mock("./electron-logger", () => ({
  logger: {
    scope: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));
vi.mock("./open-workspace", () => ({
  openWorkspace: vi.fn(() => ({ kind: "open" })),
  releaseWorkspaceOpenMark: vi.fn(),
}));
vi.mock("./quit", () => ({
  requestQuitApproval: vi.fn(() => Promise.resolve(approval.approved)),
  withdrawQuitApproval: vi.fn(),
}));
vi.mock("./relaunch", () => ({ canRelaunch: () => true, relaunchApp }));
vi.mock("./setup-facts", () => ({ refreshSetupFacts: vi.fn() }));
vi.mock("./start-workspace", () => ({
  startWorkspace: vi.fn(() => Promise.resolve()),
}));
vi.mock("./workspaces", () => ({
  getResolvedWorkspace: () => ({ id: "default", path: "/workspace" }),
}));

import { openAppWindow } from "@/electron-main/windows/app-window";

import { openWorkspace } from "./open-workspace";
import { switchWorkspace } from "./live-workspace-switch";

beforeEach(() => {
  approval.approved = true;
  relaunchApp.mockClear();
  vi.mocked(openAppWindow).mockClear();
  vi.mocked(openWorkspace).mockReturnValue({ kind: "open" });
});

/** Lets the switch that runs after the answer finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("switchWorkspace", () => {
  it("records nothing when the person keeps their running work", async () => {
    approval.approved = false;
    const choose = vi.fn();

    await expect(switchWorkspace({ choose })).resolves.toBe("canceled");

    expect(choose).not.toHaveBeenCalled();
  });

  it("records the choice and opens the next workspace's window in process", async () => {
    const choose = vi.fn();

    await expect(switchWorkspace({ choose })).resolves.toBe("switching");
    await settle();

    expect(choose).toHaveBeenCalledOnce();
    expect(openAppWindow).toHaveBeenCalledOnce();
    expect(relaunchApp).not.toHaveBeenCalled();
  });

  it("restarts when the next workspace is refused", async () => {
    vi.mocked(openWorkspace).mockReturnValue({
      kind: "refused",
      refusal: {
        kind: "unreadable",
        why: "missing",
        workspace: {
          id: "second",
          isDefault: false,
          path: "/gone",
          pinned: false,
        },
      },
    });

    await switchWorkspace({ choose: vi.fn() });
    await settle();

    expect(relaunchApp).toHaveBeenCalledOnce();
    expect(openAppWindow).not.toHaveBeenCalled();
  });
});
