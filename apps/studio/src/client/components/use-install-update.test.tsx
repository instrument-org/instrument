import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const quitAndInstall = vi.hoisted(() => vi.fn());

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { preferences: { quitAndInstall: { call: quitAndInstall } } },
}));

import { showsAsRestarting, useInstallUpdate } from "./use-install-update";

describe("useInstallUpdate", () => {
  it("stops restarting when an install fails after its request came back", async () => {
    quitAndInstall.mockResolvedValue({ type: "installing" });
    const hook = renderHook(({ status }) => useInstallUpdate(status), {
      initialProps: { status: "downloaded" as string | undefined },
    });
    await act(async () => {
      await hook.result.current.install();
    });
    hook.rerender({ status: "installing" });
    expect(hook.result.current.restarting).toBe(true);
    hook.rerender({ status: "error" });
    // The next poll folds the status back to the staged build.
    hook.rerender({ status: "downloaded" });
    expect(
      showsAsRestarting(hook.result.current.restarting, "downloaded"),
    ).toBe(false);
  });

  it("restarts from a press made while an earlier failure is showing", async () => {
    quitAndInstall.mockResolvedValue({ type: "installing" });
    const hook = renderHook(({ status }) => useInstallUpdate(status), {
      initialProps: { status: "error" as string | undefined },
    });
    await act(async () => {
      await hook.result.current.install();
    });
    expect(hook.result.current.restarting).toBe(true);
  });
});
