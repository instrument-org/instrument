import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import {
  ok,
  refused,
  standInDriver,
} from "../../test/helpers/computer-driver-stand-in";
import { capabilityRunner } from "../../test/helpers/run-capability";
import { endComputerSessions } from "../computer/driver";
import { treeText } from "../computer/tree-text";
import { grantApp } from "../permissions/apps";
import { setDenied } from "../permissions/denials";
import { updatePermissionSettings } from "../permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type CapabilityScope } from "./context";

const scope: CapabilityScope = {
  chatId: ChatIdSchema.parse("computer-chat"),
  role: "chat",
  sessionId: StoreId.newSessionId(),
};

const textEdit = {
  bundle_id: "com.apple.TextEdit",
  name: "TextEdit",
  pid: 501,
  presentation: "foreground",
};
const notes = {
  bundle_id: "com.apple.Stickies",
  name: "Stickies",
  pid: 502,
  presentation: "foreground",
};

const answers = {
  click: ok({ disposition: { delivery: "delivered_verified" }, steps: ["x"] }),
  "list-apps": ok({
    apps: [
      textEdit,
      notes,
      {
        bundle_id: "com.apple.SecurityAgent",
        name: "SecurityAgent",
        pid: 503,
        presentation: "background",
      },
      {
        bundle_id: "com.example.own",
        name: "Own",
        pid: 504,
        presentation: "foreground",
      },
      { bundle_id: "com.apple.helper", name: "Helper", pid: 505 },
    ],
  }),
  "list-windows": ok([
    { accessible: true, id: "w-1", pid: 501, title: "Untitled" },
  ]),
  press: ok({ disposition: { delivery: "delivered_unverified" } }),
  snapshot: ok({
    app: "TextEdit",
    complete: true,
    ref_count: 1,
    snapshot_id: "s1abc",
    tree: {
      children: [
        { name: "Save", ref_id: "@s1abc:e1", role: "button" },
        { name: "Body", ref_id: "@s1abc:e2", role: "textarea", value: "Hi" },
        {
          name: "Off",
          ref_id: "@s1abc:e3",
          role: "button",
          states: ["disabled"],
        },
      ],
      name: "Untitled",
      role: "window",
    },
    window: { id: "w-1", title: "Untitled" },
  }),
};

const snapshot = capabilityRunner("computer", "snapshot");
const click = capabilityRunner("computer", "click");
const apps = capabilityRunner("computer", "apps");
const press = capabilityRunner("computer", "press");
const drag = capabilityRunner("computer", "drag");
const open = capabilityRunner("computer", "open");

beforeEach(() => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "computer-perms-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    workspaceMachineDir: AbsolutePathSchema.parse(`${rootDir}-machine`),
  });
});

describe("instrument computer", () => {
  it("is not there while its flag is off", async () => {
    const driver = standInDriver(answers, { enabled: false });
    await expect(snapshot(["TextEdit"], scope)).rejects.toThrow(
      "computer.snapshot is not available on this computer.",
    );
    expect(driver.calls()).toEqual([]);
  });

  it("names Settings and stops until setup is done", async () => {
    const driver = standInDriver(answers, { ready: false });
    await expect(snapshot(["TextEdit"], scope)).rejects.toThrow(
      "Settings › Computer Use",
    );
    await expect(apps([], scope)).rejects.toThrow("Settings › Computer Use");
    expect(driver.calls()).toEqual([]);
  });

  it("asks before reading an app nobody has answered for", async () => {
    const driver = standInDriver(answers);
    await expect(snapshot(["TextEdit"], scope)).rejects.toThrow(
      "using TextEdit needs the person's yes. If the work needs it, ask for TextEdit with ask_permission.",
    );
    expect(driver.actions()).toEqual([]);
  });

  it("reads a granted app's one window, by its id, in the chat's session", async () => {
    const driver = standInDriver(answers);
    await grantApp(scope.chatId, "com.apple.TextEdit");
    const { stdout } = await snapshot(["TextEdit"], scope);
    expect(driver.actions()).toEqual([
      [
        "snapshot",
        "--window-id",
        "w-1",
        "--compact",
        "--timeout-ms",
        "10000",
        "-i",
      ],
    ]);
    expect(stdout).toMatchInlineSnapshot(`
      "Window w-1
      window "Untitled"
        button "Save" @s1abc:e1
        textarea "Body" = "Hi" @s1abc:e2
        button "Off" [disabled] @s1abc:e3
      "
    `);
  });

  it("matches an app by its whole name, never part of it", async () => {
    const driver = standInDriver(answers);
    await grantApp(scope.chatId, "com.apple.TextEdit");
    await expect(snapshot(["Text"], scope)).rejects.toThrow(
      'no app called "Text" is running',
    );
    expect(driver.actions()).toEqual([]);
  });

  it("holds a grant to the one app it was given for", async () => {
    const driver = standInDriver(answers);
    await grantApp(scope.chatId, "com.apple.TextEdit");
    await expect(snapshot(["Stickies"], scope)).rejects.toThrow(
      "using Stickies needs the person's yes",
    );
    expect(driver.actions()).toEqual([]);
  });

  it("holds a Not allowed rule in Settings", async () => {
    const driver = standInDriver(answers);
    await updatePermissionSettings((settings) => ({
      ...settings,
      apps: [{ addedAt: new Date(), level: "never", name: "TextEdit" }],
    }));
    await expect(snapshot(["TextEdit"], scope)).rejects.toThrow(
      "marked Not allowed in Settings",
    );
    expect(driver.actions()).toEqual([]);
  });

  it.each([
    ["itself", "Own", "can't drive its own windows"],
    ["a macOS password prompt", "SecurityAgent", "only they can answer it"],
  ])("never drives %s, even with a grant", async (_what, app, refusal) => {
    const driver = standInDriver(answers);
    await updatePermissionSettings((settings) => ({
      ...settings,
      apps: [{ addedAt: new Date(), level: "allow", name: app }],
    }));
    await expect(snapshot([app], scope)).rejects.toThrow(refusal);
    expect(driver.actions()).toEqual([]);
  });

  describe("an app with no bundle id, as on Windows", () => {
    const named = {
      ...answers,
      "list-apps": ok({
        apps: [{ name: "notepad", pid: 900, presentation: "foreground" }],
      }),
      "list-windows": ok([
        {
          accessible: true,
          id: "w-1.13-org-gnome-Calculator-a11y-0d6cf3d9_a607",
          pid: 900,
          title: "Untitled",
        },
      ]),
    };

    it("is asked about by its name, and its yes covers it", async () => {
      const driver = standInDriver(named);
      await expect(snapshot(["notepad"], scope)).rejects.toThrow(
        "using notepad needs the person's yes",
      );
      await grantApp(scope.chatId, "notepad");
      await snapshot(["notepad"], scope);
      expect(driver.actions().at(-1)?.slice(0, 3)).toEqual([
        "snapshot",
        "--window-id",
        "w-1.13-org-gnome-Calculator-a11y-0d6cf3d9_a607",
      ]);
    });

    it("takes a window by the long ids Linux gives them", async () => {
      standInDriver(named);
      await grantApp(scope.chatId, "notepad");
      await expect(
        snapshot(
          [
            "notepad",
            "--window",
            "w-1.13-org-gnome-Calculator-a11y-0d6cf3d9_a607",
          ],
          scope,
        ),
      ).resolves.toMatchObject({ exitCode: 0 });
    });
  });

  it.each([
    ["GNOME Shell, which draws Linux's password prompts", "gnome-shell"],
    ["Windows's elevation prompt", "consent"],
    ["another build of this app on Linux", "instrument"],
  ])("never drives %s, even with a yes", async (_what, name) => {
    const driver = standInDriver({
      ...answers,
      "list-apps": ok({
        apps: [{ name, pid: 910, presentation: "foreground" }],
      }),
    });
    await grantApp(scope.chatId, name);
    await expect(snapshot([name], scope)).rejects.toThrow(
      /can't drive|only they/,
    );
    expect(driver.actions()).toEqual([]);
  });

  describe("acting on a ref", () => {
    it("refuses a ref no snapshot in this chat gave out", async () => {
      const driver = standInDriver(answers);
      await expect(click(["@sother:e1"], scope)).rejects.toThrow(
        "isn't from a snapshot this chat took",
      );
      expect(driver.actions()).toEqual([]);
    });

    it("refuses a ref from another chat's snapshot", async () => {
      const driver = standInDriver(answers);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await snapshot(["TextEdit"], scope);
      await expect(
        click(["@s1abc:e1"], {
          ...scope,
          chatId: ChatIdSchema.parse("computer-other-chat"),
        }),
      ).rejects.toThrow("isn't from a snapshot this chat took");
      expect(driver.actions().map(([word]) => word)).toEqual(["snapshot"]);
    });

    it("acts while the app is allowed, and reads back what landed", async () => {
      const driver = standInDriver(answers);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await snapshot(["TextEdit"], scope);
      const { stdout } = await click(["@s1abc:e1"], scope);
      expect(stdout).toBe("Done (delivered verified).\n");
      expect(driver.actions().at(-1)).toEqual(["click", "@s1abc:e1"]);
    });

    it("asks again at each action, so a Not now stops the next one", async () => {
      const driver = standInDriver(answers);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await snapshot(["TextEdit"], scope);
      await setDenied(scope.chatId, "app", "TextEdit", true);
      await expect(click(["@s1abc:e1"], scope)).rejects.toThrow(
        "the person said not now to TextEdit",
      );
      expect(driver.actions().map(([word]) => word)).toEqual(["snapshot"]);
    });

    it("takes the pointer only when told to", async () => {
      const driver = standInDriver(answers);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await snapshot(["TextEdit"], scope);
      await click(["@s1abc:e1"], scope);
      await click(["@s1abc:e1", "--headed"], scope);
      expect(driver.actions().slice(1)).toEqual([
        ["click", "@s1abc:e1"],
        ["click", "@s1abc:e1", "--headed"],
      ]);
    });

    it("asks about both ends of a drag", async () => {
      const driver = standInDriver(answers);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await snapshot(["TextEdit"], scope);
      await expect(
        drag(["@s1abc:e1", "--to", "@sother:e1"], scope),
      ).rejects.toThrow("isn't from a snapshot this chat took");
      expect(driver.actions().map(([word]) => word)).toEqual(["snapshot"]);
      await drag(["@s1abc:e1", "--to", "@s1abc:e2"], scope);
      expect(driver.actions().at(-1)).toEqual([
        "drag",
        "--from",
        "@s1abc:e1",
        "--to",
        "@s1abc:e2",
        "--headed",
      ]);
    });

    it("says when a failed action may still have landed", async () => {
      const driver = standInDriver(answers);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await snapshot(["TextEdit"], scope);
      driver.setAnswers({
        ...answers,
        click: refused("APP_UNRESPONSIVE", "TextEdit stalled", "unsafe"),
      });
      await expect(click(["@s1abc:e1"], scope)).rejects.toThrow(
        "TextEdit stalled. The app isn't answering. Check its state before retrying. It may have landed: read the app's state before doing this again.",
      );
    });

    it("words a stale ref in this command's terms", async () => {
      const driver = standInDriver(answers);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await snapshot(["TextEdit"], scope);
      driver.setAnswers({
        ...answers,
        click: refused("STALE_REF", "Element no longer resolves"),
      });
      await expect(click(["@s1abc:e1"], scope)).rejects.toThrow(
        "Element no longer resolves. That element is gone or changed. Take a new snapshot and use its refs.",
      );
    });
  });

  describe("choosing a window", () => {
    const twoWindows = {
      ...answers,
      "list-windows": ok([
        { accessible: true, id: "w-1", pid: 501, title: "One" },
        { accessible: true, id: "w-2", pid: 501, title: "Two" },
        { accessible: true, id: "w-9", pid: 999, title: "Someone else's" },
      ]),
    };

    it("lists them when there's more than one to mean", async () => {
      const driver = standInDriver(twoWindows);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await expect(snapshot(["TextEdit"], scope)).rejects.toThrow(
        `TextEdit has 2 windows. Name one with --window:\nw-1 "One"\nw-2 "Two"`,
      );
      expect(driver.actions()).toEqual([]);
    });

    it("refuses a window of another process", async () => {
      const driver = standInDriver(twoWindows);
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await expect(
        snapshot(["TextEdit", "--window", "w-9"], scope),
      ).rejects.toThrow("w-9 isn't a window of TextEdit");
      expect(driver.actions()).toEqual([]);
    });

    it("says so when no window is on screen to read", async () => {
      const driver = standInDriver({
        ...answers,
        "list-windows": ok([
          { accessible: false, id: "w-1", pid: 501, title: "Elsewhere" },
        ]),
      });
      await grantApp(scope.chatId, "com.apple.TextEdit");
      await expect(snapshot(["TextEdit"], scope)).rejects.toThrow(
        "none is on the screen where it can be read",
      );
      expect(driver.actions()).toEqual([]);
    });
  });

  it("sends keys to the named app, and never overrides the driver's refusal", async () => {
    const driver = standInDriver(answers);
    await grantApp(scope.chatId, "com.apple.TextEdit");
    await press(["TextEdit", "cmd+s"], scope);
    expect(driver.actions()).toEqual([["press", "cmd+s", "--app", "TextEdit"]]);
    expect(driver.actions().flat()).not.toContain("--force");
  });

  it("lists running apps with this chat's answer for each", async () => {
    standInDriver(answers);
    await grantApp(scope.chatId, "com.apple.TextEdit");
    const { stdout } = await apps([], scope);
    expect(stdout).toBe(
      "TextEdit (com.apple.TextEdit): allowed\nStickies (com.apple.Stickies): ask first\n",
    );
  });

  it("leaves out what it can never drive, and helpers even with --all", async () => {
    standInDriver({
      ...answers,
      "list-apps": ok({
        apps: [
          {
            bundle_id: "com.example.menu",
            name: "Menu Thing",
            pid: 510,
            presentation: "background",
          },
          {
            bundle_id: "com.apple.SecurityAgent",
            name: "SecurityAgent",
            pid: 503,
            presentation: "background",
          },
          {
            bundle_id: "com.example.own",
            name: "Own",
            pid: 504,
            presentation: "foreground",
          },
          { bundle_id: "com.apple.helper", name: "Helper", pid: 505 },
        ],
      }),
    });
    expect((await apps([], scope)).stdout).toContain("No apps with a window");
    expect((await apps(["--all"], scope)).stdout).toBe(
      "Menu Thing (com.example.menu): ask first\n",
    );
  });

  it("shows the agent's cursor once per chat, from its first action", async () => {
    const chatId = ChatIdSchema.parse("computer-cursor-chat");
    const inChat = { ...scope, chatId };
    const driver = standInDriver(answers);
    await grantApp(chatId, "com.apple.TextEdit");
    await snapshot(["TextEdit"], inChat);
    const cursorCalls = () =>
      driver.calls().filter(([word]) => word === "cursor-overlay");
    expect(cursorCalls()).toEqual([]);
    await click(["@s1abc:e1"], inChat);
    await click(["@s1abc:e1"], inChat);
    expect(cursorCalls()).toEqual([
      [
        "cursor-overlay",
        "enable",
        "--label",
        "Instrument",
        "--travel-ms",
        "30,120",
      ],
    ]);
  });

  it("keeps a chat in one session of the driver's, with no trace of the windows", async () => {
    const chatId = ChatIdSchema.parse("computer-session-chat");
    const inChat = { ...scope, chatId };
    const driver = standInDriver(answers);
    await grantApp(chatId, "com.apple.TextEdit");
    await snapshot(["TextEdit"], inChat);
    await click(["@s1abc:e1"], inChat);
    const starts = driver
      .calls()
      .filter(([word, verb]) => word === "session" && verb === "start");
    expect(starts).toEqual([
      ["session", "start", "--no-trace", "--name", "Instrument"],
    ]);
  });

  it("ends every session when the app quits, and starts afresh after", async () => {
    const chatId = ChatIdSchema.parse("computer-quit-chat");
    const inChat = { ...scope, chatId };
    const driver = standInDriver(answers);
    await grantApp(chatId, "com.apple.TextEdit");
    await snapshot(["TextEdit"], inChat);
    await endComputerSessions();
    expect(
      driver
        .calls()
        .filter(([word, verb]) => word === "session" && verb === "end"),
    ).toContainEqual(["session", "end", "run-stand-in"]);
    await snapshot(["TextEdit"], inChat);
    expect(
      driver
        .calls()
        .filter(([word, verb]) => word === "session" && verb === "start")
        .length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("says when a refused shortcut has no way past it here", async () => {
    const driver = standInDriver({
      ...answers,
      press: refused(
        "POLICY_DENIED",
        "Key combo 'cmd+q' is blocked for safety; pass --force to override",
      ),
    });
    await grantApp(scope.chatId, "com.apple.TextEdit");
    await expect(press(["TextEdit", "cmd+q"], scope)).rejects.toThrow(
      "That shortcut is refused here, since it could quit an app or log the person out.",
    );
    expect(driver.actions().flat()).not.toContain("--force");
  });

  it("waits a moment for a new app's window, and says when none came", async () => {
    standInDriver({ ...answers, launch: ok({ pid: 7 }) });
    await grantApp(scope.chatId, "com.apple.TextEdit");
    expect((await open(["TextEdit"], scope)).stdout).toBe(
      'It\'s running, with window w-1 "Untitled".\n',
    );
    standInDriver({
      ...answers,
      launch: ok({ pid: 7 }),
      "list-windows": ok([]),
    });
    expect((await open(["TextEdit"], scope)).stdout).toContain(
      "with no window yet",
    );
  });

  it("brings an app forward only with --headed, which is what takes focus", async () => {
    const driver = standInDriver({
      ...answers,
      launch: ok({ pid: 7, window: { id: "w-9", title: "Open" } }),
    });
    await grantApp(scope.chatId, "com.apple.TextEdit");
    await open(["TextEdit"], scope);
    expect(driver.actions().at(-1)).toEqual(["launch", "com.apple.TextEdit"]);
    await open(["TextEdit", "--headed"], scope);
    expect(driver.actions().at(-1)).toEqual([
      "launch",
      "com.apple.TextEdit",
      "--activate",
    ]);
  });

  it("reports the window the driver already named, with no wait", async () => {
    const driver = standInDriver({
      ...answers,
      launch: ok({ pid: 7, window: { id: "w-9", title: "Open" } }),
    });
    await grantApp(scope.chatId, "com.apple.TextEdit");
    expect((await open(["TextEdit"], scope)).stdout).toBe(
      'It\'s running, with window w-9 "Open".\n',
    );
    expect(driver.calls().flat()).not.toContain("list-windows");
  });

  it("asks before starting an app, and starts it by its bundle id", async () => {
    const driver = standInDriver({ ...answers, launch: ok({ pid: 7 }) });
    await expect(open(["TextEdit"], scope)).rejects.toThrow(
      "using TextEdit needs the person's yes",
    );
    expect(driver.actions()).toEqual([]);
    await grantApp(scope.chatId, "com.apple.TextEdit");
    await open(["TextEdit"], scope);
    expect(driver.actions()).toEqual([["launch", "com.apple.TextEdit"]]);
  });
});

describe("treeText", () => {
  it("shows what a skeleton cut, and shortens a long value", () => {
    expect(
      treeText({
        children: [
          {
            children_count: 12,
            name: "Sidebar",
            ref_id: "@s:e1",
            role: "group",
          },
          { role: "textarea", value: "x".repeat(205) },
        ],
        role: "window",
      }),
    ).toMatchInlineSnapshot(`
      "window
        group "Sidebar" (12 inside) @s:e1
        textarea = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…""
    `);
  });
});
