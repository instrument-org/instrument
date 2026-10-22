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
  openAppWindowAfterSwitch: vi.fn(),
}));
vi.mock("./capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));
vi.mock("./agent-completion-notifications", () => ({
  closeCompletionNotifications: vi.fn(),
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

import {
  closeAppWindowForSwitch,
  openAppWindowAfterSwitch,
} from "@/electron-main/windows/app-window";

import { openWorkspace } from "./open-workspace";
import { requestQuitApproval } from "./quit";
import { isSwitchingWorkspace, switchWorkspace } from "./live-workspace-switch";

beforeEach(() => {
  approval.approved = true;
  relaunchApp.mockClear();
  vi.mocked(openAppWindowAfterSwitch).mockClear();
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
    // Read as the window closes, where `window-all-closed` asks it.
    let switchingAsTheWindowCloses = false;
    vi.mocked(closeAppWindowForSwitch).mockImplementationOnce(() => {
      switchingAsTheWindowCloses = isSwitchingWorkspace();
      return Promise.resolve();
    });

    await expect(switchWorkspace({ choose })).resolves.toBe("switching");
    await settle();

    expect(choose).toHaveBeenCalledOnce();
    expect(switchingAsTheWindowCloses).toBe(true);
    expect(isSwitchingWorkspace()).toBe(false);
    expect(openAppWindowAfterSwitch).toHaveBeenCalledOnce();
    expect(relaunchApp).not.toHaveBeenCalled();
  });

  it("turns down a second switch asked while the first one's question is open", async () => {
    let answer: (approved: boolean) => void = () => undefined;
    vi.mocked(requestQuitApproval).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const first = switchWorkspace({ choose: vi.fn() });
    const secondChoice = vi.fn();

    await expect(switchWorkspace({ choose: secondChoice })).resolves.toBe(
      "canceled",
    );
    answer(false);
    await expect(first).resolves.toBe("canceled");
    expect(secondChoice).not.toHaveBeenCalled();
    expect(isSwitchingWorkspace()).toBe(false);
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
    expect(openAppWindowAfterSwitch).not.toHaveBeenCalled();
  });
});
