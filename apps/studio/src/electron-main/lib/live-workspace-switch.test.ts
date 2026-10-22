import { beforeEach, describe, expect, it, vi } from "vitest";

const approval = vi.hoisted(() => ({ approved: true, quitting: false }));
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
vi.mock("./claude-account", () => ({
  cancelClaudeSignIn: vi.fn(),
  forgetClaudeAccountReading: vi.fn(),
}));
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
  isQuitUnderway: () => approval.quitting,
  requestQuitApproval: vi.fn(() => Promise.resolve(approval.approved)),
  withdrawQuitApproval: vi.fn(),
}));
vi.mock("./quit-machine", () => ({ BROWSER_SESSIONS_CLOSE_MS: 3000 }));
vi.mock("@instrument-org/workspace/electron", () => ({
  BACKGROUND_PROCESS_TEARDOWN_MS: 5000,
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
import {
  type RunningWorkspace,
  setRunningWorkspace,
  workspaceSwitchSettled,
} from "./running-workspace";
import { isSwitchingWorkspace, switchWorkspace } from "./live-workspace-switch";

beforeEach(() => {
  approval.approved = true;
  approval.quitting = false;
  setRunningWorkspace(undefined);
  relaunchApp.mockClear();
  vi.mocked(openAppWindowAfterSwitch).mockClear();
  vi.mocked(openWorkspace).mockClear();
  vi.mocked(openWorkspace).mockReturnValue({ kind: "open" });
});

/** A running workspace whose close is `close`; the switch reads nothing else of it, hence the cast. */
function fakeRunning(close: () => Promise<void>) {
  return { close } as unknown as RunningWorkspace;
}

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

  it("is turned down once a quit is under way", async () => {
    approval.quitting = true;
    const choose = vi.fn();

    await expect(switchWorkspace({ choose })).resolves.toBe("canceled");
    expect(choose).not.toHaveBeenCalled();
  });

  it("leaves the next workspace to the next launch when a quit comes while it closes", async () => {
    let closed: () => void = () => undefined;
    setRunningWorkspace(
      fakeRunning(
        () =>
          new Promise<void>((resolve) => {
            closed = resolve;
          }),
      ),
    );
    await switchWorkspace({ choose: vi.fn() });
    await settle();
    approval.quitting = true;
    const quitWaited = vi.fn();
    const waiting = workspaceSwitchSettled().then(quitWaited);
    await settle();
    // The quit waits for the switch to finish closing before it reads it.
    expect(quitWaited).not.toHaveBeenCalled();

    closed();
    await waiting;

    expect(openWorkspace).not.toHaveBeenCalled();
    expect(openAppWindowAfterSwitch).not.toHaveBeenCalled();
  });

  it("restarts when closing the workspace runs past its deadline", async () => {
    vi.useFakeTimers();
    try {
      setRunningWorkspace(
        fakeRunning(() => new Promise<void>(() => undefined)),
      );
      await switchWorkspace({ choose: vi.fn() });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(relaunchApp).toHaveBeenCalledOnce();
      expect(openAppWindowAfterSwitch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
