import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { chatDir } from "../record-folders";
import {
  addressAppsById,
  createOsascriptCommand,
  worksAppWindows,
} from "./osascript";
import { taskLayout } from "../../test/helpers/task-layout";

vi.mock("execa");

const mockCtx = createCommandContext({
  cwd: "/task",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

async function mockExeca() {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValueOnce({ all: "", exitCode: 0 } as never);
  return execa;
}

describe("osascriptCommand", () => {
  const taskId = createMockChatConfig(ChatIdSchema.parse("test"));
  const command = createOsascriptCommand(taskId, taskLayout(taskId));

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("runs the system osascript with the script as given", async () => {
    const execa = await mockExeca();
    const script = 'tell application "Reminders" to count reminders';

    await command.execute(["-e", script], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-e", script],
      expect.objectContaining({ stdin: "ignore" }),
    );
  });

  // Mail's own extensions register under the name "Mail", so by name a
  // script reaches an extension and none of Mail's words compile.
  it("names Mail by its bundle id, inline and piped", async () => {
    const execa = await mockExeca();
    await command.execute(
      ["-e", 'tell application "Mail" to get name of every account'],
      mockCtx,
    );
    expect(vi.mocked(execa)).toHaveBeenLastCalledWith(
      "/usr/bin/osascript",
      [
        "-e",
        'tell application id "com.apple.mail" to get name of every account',
      ],
      expect.anything(),
    );

    await mockExeca();
    await command.execute(["-l", "JavaScript", "-"], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(
        "Application('Mail').inbox.messages[0].subject()",
      ),
    });
    expect(vi.mocked(execa)).toHaveBeenLastCalledWith(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-"],
      expect.objectContaining({
        input: Buffer.from(
          'Application("com.apple.mail").inbox.messages[0].subject()',
        ),
      }),
    );
  });

  it.each([
    ['tell app "Mail" to activate', 'tell app id "com.apple.mail" to activate'],
    [
      'using terms from application "Mail"',
      'using terms from application id "com.apple.mail"',
    ],
    // System Events names a process, not an app, and the "Mail" here is text.
    [
      'tell application "System Events" to get process "Mail"',
      'tell application "System Events" to get process "Mail"',
    ],
    ['display dialog "Mail"', 'display dialog "Mail"'],
    [
      'tell application "Mailplane" to quit',
      'tell application "Mailplane" to quit',
    ],
  ])("addresses %j as %j", (code, expected) => {
    expect(addressAppsById(code)).toBe(expected);
  });

  it("forwards a piped script", async () => {
    const execa = await mockExeca();
    const script = "return 1 + 1";

    await command.execute(["-"], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(script),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-"],
      expect.objectContaining({ input: Buffer.from(script) }),
    );
  });

  it.each([
    ["-l", "JavaScript", "-e", "var re=/^a/"],
    ["-e", 'open location "https://x.com/?a=/b"'],
  ])(
    "runs a script whose text only looks like a path: %s %s",
    async (...args) => {
      const execa = await mockExeca();

      const result = await command.execute(args, mockCtx);

      expect(result.exitCode).toBe(0);
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "/usr/bin/osascript",
        args,
        expect.anything(),
      );
    },
  );

  it("points a quoted task path in the script at the task folder", async () => {
    const execa = await mockExeca();

    await command.execute(
      ["-e", 'read POSIX file "/task/invite.ics"'],
      mockCtx,
    );

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-e", `read POSIX file "${chatDir(taskId)}/invite.ics"`],
      expect.anything(),
    );
  });

  it("refuses a quoted attached-folder path in the script", async () => {
    const result = await command.execute(
      ["-e", 'read POSIX file "/mnt/Home/invite.ics"'],
      mockCtx,
    );

    expect(result.exitCode).toBe(1);
  });

  it.each([
    // Taken from the Raycast tasks that clicked through Settings for minutes.
    'tell application "System Events" to tell process "Raycast" to click menu item "Settings…" of menu 1 of menu bar item 1 of menu bar 2',
    'tell application "System Events" to tell process "Raycast" to get entire contents of window "Settings"',
    'tell application "System Events" to tell process "Raycast" to perform action "AXPress" of button 1 of group 8',
    'tell application "System Events" to keystroke "v" using command down',
    'tell application "System Events" to key code 36',
    'Application("System Events").processes.byName("Raycast").windows[0].buttons[0].click()',
    'Application("System Events").keystroke("snippets")',
  ])("treats %j as working an app's windows", (code) => {
    expect(worksAppWindows(code)).toBe(true);
  });

  it.each([
    'tell application "Reminders" to make new reminder with properties {name:"Call Sam"}',
    'tell application "System Events" to get name of every process',
    'tell application "System Events" to exists process "Raycast"',
    'tell application "System Events" to get name of every login item',
    'tell application "Finder" to get name of every window',
    'display dialog "Click OK to keep going"',
  ])("lets %j run", (code) => {
    expect(worksAppWindows(code)).toBe(false);
  });

  it("refuses a script that works an app's windows, inline, piped, or from a file", async () => {
    const script =
      'tell application "System Events" to tell process "Raycast" to click button 1 of window 1';
    const fs = new InMemoryFs();
    await fs.writeFile("/task/work/drive.applescript", script);

    const results = [
      await command.execute(["-e", script], mockCtx),
      await command.execute(["-"], {
        ...mockCtx,
        stdin: encodeUtf8ToBytes(script),
      }),
      await command.execute(["work/drive.applescript"], { ...mockCtx, fs }),
    ];

    const { execa } = await import("execa");
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
    expect(results.map((result) => result.exitCode)).toEqual([1, 1, 1]);
    expect(results[0]?.stderr).toContain("import or config file");
  });

  it("refuses a script file on a mount it cannot reach", async () => {
    const result = await command.execute(["/mnt/Home/script.scpt"], mockCtx);

    expect(result.exitCode).toBe(1);
  });
});
