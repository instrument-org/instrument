import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type NativeReach } from "./index";

const execFileSync = vi.hoisted(() => vi.fn());

// The kernel settings and the bubblewrap install a Linux case reads.
const files = vi.hoisted(() => ({
  bwrap: true,
  settings: {} as Record<string, string>,
}));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    existsSync: (file: string) =>
      file === "/usr/bin/bwrap" ? files.bwrap : fs.existsSync(file),
    readFileSync: (file: string, ...rest: unknown[]): unknown =>
      file.startsWith("/proc/sys/")
        ? (files.settings[file] ??
          failure({ code: "ENOENT", message: `no ${file}` }))
        : (fs.readFileSync as (...args: unknown[]) => unknown)(file, ...rest),
  };
});

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync,
}));

// Each case reloads the module and so a fresh config holder; a config with
// no Seatbelt launcher keeps every wrapped command on sandbox-exec.
vi.mock("../workspace-config", () => ({
  getWorkspaceConfig: () => ({}),
  hasWorkspaceConfig: () => true,
  setWorkspaceConfig: () => undefined,
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
      await import("./index");
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

  it("refuses a command whatever Seatbelt printed, and asks again", async () => {
    const {
      NativeSandboxUnavailableError,
      nativeSandboxOff,
      wrapNativeCommand,
    } = await import("./index");
    execFileSync.mockImplementation(() =>
      failure({
        status: 71,
        stderr: "sandbox-exec: sandbox_apply: Operation not permitted\n",
      }),
    );
    expect(() => wrapNativeCommand("cat", ["x"], reach)).toThrow(
      NativeSandboxUnavailableError,
    );
    expect(() => wrapNativeCommand("cat", ["x"], reach)).toThrow(
      NativeSandboxUnavailableError,
    );
    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(nativeSandboxOff()).toBeUndefined();
  });

  it("says the sandbox is enforced while a probe has no answer", async () => {
    const { nativeSandboxEnforced } = await import("./index");
    execFileSync.mockImplementation(() =>
      failure({ code: "ETIMEDOUT", signal: "SIGTERM", status: null }),
    );
    expect(nativeSandboxEnforced()).toBe(true);
  });
});

describe("the sandbox probe on Linux", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileSync.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(process, "platform", { value: "linux" });
    files.bwrap = true;
    files.settings = {};
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    vi.restoreAllMocks();
  });

  it.each([
    ["/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "1"],
    ["/proc/sys/kernel/unprivileged_userns_clone", "0"],
    ["/proc/sys/user/max_user_namespaces", "0"],
  ])("runs unwrapped and says why when %s is %s", async (setting, value) => {
    const { nativeSandboxOff, wrapNativeCommand } = await import("./index");
    files.settings[setting] = value;
    execFileSync.mockImplementation(() =>
      failure({ status: 1, stderr: "bwrap: anything at all\n" }),
    );
    expect(wrapNativeCommand("cat", ["x"], reach).kind).toBe("unwrapped");
    expect(nativeSandboxOff()).toBe("user-namespaces-closed");
  });

  // "Permission denied" from a failure the settings do not explain was once
  // read as namespaces closed, and ran every command with no rules.
  it("refuses a command when the settings leave namespaces open, whatever bwrap printed", async () => {
    const {
      NativeSandboxUnavailableError,
      nativeSandboxOff,
      wrapNativeCommand,
    } = await import("./index");
    files.settings["/proc/sys/kernel/apparmor_restrict_unprivileged_userns"] =
      "0";
    execFileSync.mockImplementation(() =>
      failure({ status: 1, stderr: "bwrap: Permission denied\n" }),
    );
    expect(() => wrapNativeCommand("cat", ["x"], reach)).toThrow(
      NativeSandboxUnavailableError,
    );
    expect(nativeSandboxOff()).toBeUndefined();
  });

  it("runs unwrapped and says so where bubblewrap is not installed", async () => {
    const { nativeSandboxOff, wrapNativeCommand } = await import("./index");
    files.bwrap = false;
    execFileSync.mockImplementation(() => failure({ code: "ENOENT" }));
    expect(wrapNativeCommand("cat", ["x"], reach).kind).toBe("unwrapped");
    expect(nativeSandboxOff()).toBe("no-bubblewrap");
  });
});
