import { afterEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync }));

// The helper caches its Command Line Tools probe per module instance, so each
// case imports a fresh module and controls platform/env/probe independently.
async function loadHostCompilerEnv({
  cc,
  hasTools,
  platform,
}: {
  cc?: string;
  hasTools: boolean;
  platform: NodeJS.Platform;
}) {
  vi.resetModules();
  execFileSync.mockReset();
  if (hasTools) {
    execFileSync.mockReturnValue(
      Buffer.from("/Library/Developer/CommandLineTools"),
    );
  } else {
    execFileSync.mockImplementation(() => {
      throw new Error("no developer tools");
    });
  }

  const platformSpy = vi
    .spyOn(process, "platform", "get")
    .mockReturnValue(platform);
  const priorCC = process.env.CC;
  if (cc === undefined) {
    delete process.env.CC;
  } else {
    process.env.CC = cc;
  }

  const { hostCompilerEnv } = await import("./host-compiler-env");
  const result = hostCompilerEnv();

  platformSpy.mockRestore();
  if (priorCC === undefined) {
    delete process.env.CC;
  } else {
    process.env.CC = priorCC;
  }
  return { result };
}

describe("hostCompilerEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("neutralizes the compiler on macOS without Command Line Tools", async () => {
    const { result } = await loadHostCompilerEnv({
      hasTools: false,
      platform: "darwin",
    });
    expect(result).toEqual({ CC: "/usr/bin/false", CXX: "/usr/bin/false" });
    expect(execFileSync).toHaveBeenCalledWith(
      "xcode-select",
      ["-p"],
      expect.anything(),
    );
  });

  it("leaves the env untouched when Command Line Tools are installed", async () => {
    const { result } = await loadHostCompilerEnv({
      hasTools: true,
      platform: "darwin",
    });
    expect(result).toEqual({});
  });

  it("respects an explicitly configured $CC without probing", async () => {
    const { result } = await loadHostCompilerEnv({
      cc: "/opt/homebrew/bin/clang",
      hasTools: false,
      platform: "darwin",
    });
    expect(result).toEqual({});
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("does nothing on non-macOS hosts", async () => {
    const { result } = await loadHostCompilerEnv({
      hasTools: false,
      platform: "linux",
    });
    expect(result).toEqual({});
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
