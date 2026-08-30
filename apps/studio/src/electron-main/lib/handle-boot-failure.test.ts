import { APP_NAME } from "@instrument-org/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleBootFailure } from "./handle-boot-failure";

const { captureServerException, exit, showErrorBox } = vi.hoisted(() => ({
  captureServerException: vi.fn(),
  exit: vi.fn(),
  showErrorBox: vi.fn(),
}));

vi.mock("./capture-server-exception", () => ({ captureServerException }));
vi.mock("electron", () => ({
  app: { exit },
  dialog: { showErrorBox },
}));

describe("handleBootFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the failure, tells the user which step died, and exits", () => {
    const inner = new Error("db locked");
    const error = new Error("Boot failed during createWorkspaceActor", {
      cause: inner,
    });

    handleBootFailure(error);

    expect(captureServerException).toHaveBeenCalledWith(error, {
      scopes: ["studio"],
    });
    expect(showErrorBox).toHaveBeenCalledWith(
      `${APP_NAME} could not start`,
      "Boot failed during createWorkspaceActor: db locked",
    );
    expect(exit).toHaveBeenCalledWith(1);
    // The dialog blocks until dismissed, so exiting after it means the user
    // saw the message before the process went away.
    expect(showErrorBox.mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("shows a failure that wrapped nothing as its own message", () => {
    handleBootFailure(new Error("renderer bundle missing"));

    expect(showErrorBox).toHaveBeenCalledWith(
      `${APP_NAME} could not start`,
      "renderer bundle missing",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
