import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { type ComputerUseHost } from "../../types";
import { shellLayout } from "../create-bash-env";
import { taskDir } from "../task-dir-utils";
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
    // with the tree twice over and a menu bar, the way the driver does.
    await writeFile(
      driver,
      `#!/bin/sh
echo "$@" >> "${log}"
case "$2" in
  get_window_state) printf '%s\\n' '{"_note":"Prefer elements","element_count":3,"elements":[{"element_index":0}],"tree_markdown":"- [0] AXWindow \\"Notes\\"\\n  - [1] AXButton \\"OK\\"\\n- [2] AXMenuBar\\n  - AXMenuBarItem \\"File\\"\\n    - AXMenuItem \\"Export…\\"\\n- [3] AXButton \\"After\\""}' ;;
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
        isReady: () => true,
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

  it.each([
    ["setup is incomplete", { isReady: () => false }],
    [
      "a grant goes missing after setup",
      {
        connect: () =>
          Promise.resolve({
            missing: ["accessibility" as const],
            status: "needs-permission" as const,
          }),
      },
    ],
  ])("points the user at Settings when %s", async (_case, overrides) => {
    useHost(overrides);
    const result = await run(["list_apps"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Settings, Computer Use");
    await expect(readFile(log, "utf8")).rejects.toThrow();
  });

  it("reports a driver that fails to start as the app's fault", async () => {
    useHost({
      connect: () =>
        Promise.resolve({ reason: "dlopen failed", status: "unavailable" }),
    });
    const result = await run(["list_apps"]);
    expect(result.stdout).toContain("fault in Instrument");
    expect(result.stdout).toContain("dlopen failed");
  });

  it("refuses a tool outside the allowlist", async () => {
    useHost();
    const result = await run(["kill_app", '{"pid":1}']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("not a tool here");
  });

  it("runs the tool in the task's own session, with the cursor shown, on the private socket", async () => {
    useHost();
    const result = await run([
      "click",
      '{"pid":844,"element_index":3,"session":"preview-edit"}',
    ]);
    expect(result.exitCode).toBe(0);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    expect(calls).toMatchInlineSnapshot(`
      [
        "call start_session {"session":"Instrument"} --socket /tmp/cua.sock",
        "call set_agent_cursor_enabled {"enabled":true,"session":"Instrument"} --socket /tmp/cua.sock",
        "call click {"pid":844,"element_index":3} --session Instrument --socket /tmp/cua.sock",
      ]
    `);
  });

  it("hands launch_app the host path behind a sandbox path", async () => {
    useHost();
    await run([
      "launch_app",
      '{"bundle_id":"com.apple.Preview","urls":["work/shot.png","https://example.com"]}',
    ]);
    const launch = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .find((call) => call.startsWith("call launch_app"));
    expect(launch).toContain(
      JSON.stringify([
        path.join(taskDir(taskId), "work", "shot.png"),
        "https://example.com",
      ]),
    );
  });

  it("trims a window snapshot to its markdown tree without the menu bar", async () => {
    useHost();
    const result = await run(["get_window_state", '{"pid":844,"window_id":1}']);
    expect(result.stdout).toMatchInlineSnapshot(`
      "{
        "element_count": 3
      }

      - [0] AXWindow "Notes"
        - [1] AXButton "OK"
      - AXMenuBar (omitted; use invoke_menu)
      - [3] AXButton "After"
      "
    `);
  });
});
