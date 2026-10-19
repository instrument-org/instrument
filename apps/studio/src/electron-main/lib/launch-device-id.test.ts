import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { chooseLaunchDeviceId } from "./launch-device-id";

const { info, stored } = vi.hoisted(() => ({
  info: vi.fn(),
  stored: new Map<string, unknown>(),
}));

vi.mock("@/electron-main/stores/machine/state", () => ({
  getMachineState: () => ({
    delete: (key: string) => stored.delete(key),
    get: (key: string) => stored.get(key),
    set: (key: string, value: unknown) => stored.set(key, value),
  }),
}));

vi.mock("./electron-logger", () => ({ logger: { info } }));

vi.mock("./get-workspace-folder", () => ({
  workspaceMachineDir: () => "/machine/default",
}));

vi.mock("./workspaces", () => ({ openElsewhereBy: () => null }));

function machine(id: string) {
  return () => Promise.resolve({ id, kind: "read" as const });
}

function hash(id: string) {
  return createHash("sha256").update(id).digest("hex");
}

describe("chooseLaunchDeviceId", () => {
  beforeEach(() => {
    stored.clear();
    info.mockClear();
  });

  it("stores a new id on the first launch and keeps it on the same hardware", async () => {
    const first = await chooseLaunchDeviceId(machine("MAC-1"));

    expect(first).toMatch(/^dev_[0-9A-Z]{8}$/);
    expect(Object.fromEntries(stored)).toEqual({
      deviceId: first,
      hardwareId: hash("MAC-1"),
    });
    expect(info).toHaveBeenCalledWith(`Device id ${first}: new-install`);

    await expect(chooseLaunchDeviceId(machine("MAC-1"))).resolves.toBe(first);
    expect(info).toHaveBeenLastCalledWith(`Device id ${first}: kept`);
  });

  it("writes as a new device on other hardware, as a restored backup is", async () => {
    const first = await chooseLaunchDeviceId(machine("MAC-1"));
    const restored = await chooseLaunchDeviceId(machine("MAC-2"));

    expect(restored).not.toBe(first);
    expect(Object.fromEntries(stored)).toEqual({
      deviceId: restored,
      hardwareId: hash("MAC-2"),
    });
    expect(info).toHaveBeenLastCalledWith(
      `Device id ${restored}: other-hardware`,
    );
  });

  it("keeps the stored id when the machine's id cannot be read, and says why", async () => {
    const first = await chooseLaunchDeviceId(machine("MAC-1"));
    const unreadable = () =>
      Promise.resolve({ kind: "unreadable" as const, why: "ioreg timed out" });

    await expect(chooseLaunchDeviceId(unreadable)).resolves.toBe(first);
    expect(stored.get("hardwareId")).toBe(hash("MAC-1"));
    expect(info).toHaveBeenLastCalledWith(
      `Device id ${first}: kept-machine-id-unreadable (ioreg timed out)`,
    );
  });

  // Two worktrees' dev runs share one userData, and so its stored id.
  it("writes as a device of its own, unstored, while another process has the workspace open", async () => {
    const first = await chooseLaunchDeviceId(machine("MAC-1"));
    const second = await chooseLaunchDeviceId(machine("MAC-1"), () => 4242);

    expect(second).toMatch(/^dev_[0-9A-Z]{8}$/);
    expect(second).not.toBe(first);
    expect(stored.get("deviceId")).toBe(first);
    expect(info).toHaveBeenLastCalledWith(
      `Device id ${second}: for this launch only, since pid 4242 has the workspace open`,
    );
  });
});
