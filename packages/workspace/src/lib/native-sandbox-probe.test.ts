import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type NativeReach } from "./native-sandbox";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync,
}));

const reach: NativeReach = {
  readOnly: [],
  readWrite: [],
  rules: { home: "/nope/home", rules: [], dangerouslyAllowEveryFolder: false },
};

/** The probe failing as execFileSync reports a timeout or a refusal. */
function failure(fields: Record<string, unknown>): never {
  throw Object.assign(new Error("probe"), fields);
}

const platform = process.platform;

describe("the sandbox probe on macOS", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileSync.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(process, "platform", { value: "darwin" });
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    vi.restoreAllMocks();
  });

  it("refuses a command when the probe timed out, then probes again", async () => {
    const { NativeSandboxUnavailableError, wrapNativeCommand } =
      await import("./native-sandbox");
    execFileSync.mockImplementationOnce(() =>
      failure({ code: "ETIMEDOUT", signal: "SIGTERM", status: null }),
    );
    expect(() => wrapNativeCommand("cat", [], reach)).toThrow(
      NativeSandboxUnavailableError,
    );
    expect(console.warn).toHaveBeenCalledOnce();
    // The next command probes again, and runs sandboxed once it answers.
    execFileSync.mockImplementationOnce(() => Buffer.from(""));
    expect(wrapNativeCommand("cat", [], reach).file).toBe(
      "/usr/bin/sandbox-exec",
    );
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it("runs unwrapped where Seatbelt said it cannot nest, and asks once", async () => {
    const { wrapNativeCommand } = await import("./native-sandbox");
    execFileSync.mockImplementation(() =>
      failure({
        status: 71,
        stderr: "sandbox-exec: sandbox_apply: Operation not permitted\n",
      }),
    );
    expect(wrapNativeCommand("cat", ["x"], reach)).toEqual({
      args: ["x"],
      file: "cat",
    });
    wrapNativeCommand("cat", ["x"], reach);
    expect(execFileSync).toHaveBeenCalledOnce();
  });

  it("says the sandbox is enforced while a probe has no answer", async () => {
    const { nativeSandboxEnforced } = await import("./native-sandbox");
    execFileSync.mockImplementation(() =>
      failure({ code: "ETIMEDOUT", signal: "SIGTERM", status: null }),
    );
    expect(nativeSandboxEnforced()).toBe(true);
  });
});
