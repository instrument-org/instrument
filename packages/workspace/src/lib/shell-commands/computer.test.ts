import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { type ComputerUseHost } from "../../types";
import { shellLayout } from "../create-bash-env";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createComputerCommand } from "./computer";

const ctx = createCommandContext({
  cwd: "/task",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe.skipIf(process.platform === "win32")("computer", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("computer-test"));
  const layout = shellLayout({ taskId });
  const config = getWorkspaceConfig();
  let dir: string;
  let driver: string;
  let log: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "computer-test-"));
    driver = path.join(dir, "cua-driver");
    log = path.join(dir, "calls.log");
    // Stands in for cua-driver: records each argv, answers get_window_state
    // with the tree twice over the way the driver does.
    await writeFile(
      driver,
      `#!/bin/sh
echo "$@" >> "${log}"
case "$2" in
  get_window_state) echo '{"element_count":1,"elements":[{"element_index":0}],"tree_markdown":"- [element_index 0] AXButton \\"OK\\""}' ;;
  *) echo '{"ok":true}' ;;
esac
`,
    );
    await chmod(driver, 0o755);
  });

  afterAll(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  afterEach(async () => {
    setWorkspaceConfig(config);
    await rm(log, { force: true });
  });

  function useHost(overrides: Partial<ComputerUseHost> = {}) {
    setWorkspaceConfig({
      ...config,
      computerUse: {
        connect: () =>
          Promise.resolve({
            binaryPath: driver,
            socketPath: "/tmp/cua.sock",
            status: "ready",
          }),
        isEnabled: () => true,
        requestPermissions: () => Promise.resolve({ supported: false }),
        ...overrides,
      },
    });
  }

  const run = (args: string[]) =>
    createComputerCommand({ layout, taskId }).execute(args, ctx);

  it("refuses while the feature is off", async () => {
    useHost({ isEnabled: () => false });
    const result = await run(["list_apps"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("turned off");
  });

  it("asks for setup when macOS grants are missing", async () => {
    useHost({
      connect: () =>
        Promise.resolve({
          missing: ["accessibility"],
          status: "needs-permission",
        }),
    });
    const result = await run(["list_apps"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Accessibility");
    expect(result.stdout).toContain("computer setup");
  });

  it("refuses a tool outside the allowlist", async () => {
    useHost();
    const result = await run(["kill_app", '{"pid":1}']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("not a tool here");
  });

  it("runs the tool in the task's session on the private socket", async () => {
    useHost();
    const result = await run(["click", '{"pid":844,"element_index":3}']);
    expect(result.exitCode).toBe(0);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    expect(calls).toEqual([
      `call start_session {"session":"instrument-${taskId}"} --socket /tmp/cua.sock`,
      `call click {"pid":844,"element_index":3} --session instrument-${taskId} --socket /tmp/cua.sock`,
    ]);
  });

  it("drops the duplicate element array from a window snapshot", async () => {
    useHost();
    const result = await run(["get_window_state", '{"pid":844,"window_id":1}']);
    expect(result.stdout).not.toContain('"elements"');
    expect(result.stdout).toContain('[element_index 0] AXButton "OK"');
    expect(result.stdout).toContain('"element_count": 1');
  });
});
