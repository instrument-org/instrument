import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { appToAskOffMac } from "../computer/targets";
import { treeText } from "../computer/tree-text";
import { appLevel, grantApp } from "../permissions/apps";
import { setDenied } from "../permissions/denials";
import { updatePermissionSettings } from "../permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type CapabilityScope } from "./context";

const startMenu = vi.hoisted(() => ({
  afterOpening: () => {},
  apps: [
    {
      AppID: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
      Name: "Calculator",
    },
    { AppID: "Microsoft.Windows.Explorer", Name: "File Explorer" },
    { AppID: "Microsoft.Office.WINWORD.EXE.15", Name: "Microsoft Word" },
    { AppID: "Microsoft.Paint_8wekyb3d8bbwe!App", Name: "Paint" },
  ],
  displayName: undefined as string | undefined,
  opened: [] as string[],
  readAhead: 0,
}));

vi.mock("../computer/start-menu", () => ({
  closeStartMenuNames: (given: string) =>
    Promise.resolve(
      startMenu.apps
        .map((app) => app.Name)
        .filter((name) => name.toLowerCase().includes(given.toLowerCase())),
    ),
  displayNameOfProcess: () => Promise.resolve(startMenu.displayName),
  openStartMenuApp: (app: { AppID: string }) => {
    startMenu.opened.push(app.AppID);
    startMenu.afterOpening();
    return Promise.resolve();
  },
  readStartMenuAhead: () => {
    startMenu.readAhead += 1;
  },
  startMenuApp: (given: string) =>
    Promise.resolve(
      startMenu.apps.find(
        (app) => app.Name.toLowerCase() === given.toLowerCase(),
      ),
    ),
}));

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
  // These desktops list their apps, as macOS's and Linux's do. "on Windows" has
  // its own, read from windows, and sets its platform for itself.
  if (process.platform === "win32") {
    Object.defineProperty(process, "platform", { value: "linux" });
  }
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

  describe("an app with no bundle id", () => {
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
        "--multi-agent",
        "--label",
        "Instrument",
        "--travel-ms",
        "30,120",
      ],
    ]);
  });

  it("names the cursor on every action, but not when enabling it, which the driver refuses", async () => {
    const chatId = ChatIdSchema.parse("computer-cursor-name-chat");
    const inChat = { ...scope, chatId };
    const driver = standInDriver(answers);
    await grantApp(chatId, "com.apple.TextEdit");
    await snapshot(["TextEdit"], inChat);
    await click(["@s1abc:e1"], inChat);
    const callOf = (word: string) =>
      driver.rawCalls().find(([first]) => first === word);
    expect(callOf("cursor-overlay")).not.toContain("--agent-id");
    expect(callOf("cursor-overlay")?.slice(-2)).toEqual([
      "--session",
      "run-stand-in",
    ]);
    expect(callOf("click")?.slice(-4)).toEqual([
      "--agent-id",
      "instrument",
      "--session",
      "run-stand-in",
    ]);
  });

  it.each(["-5", "- Buy milk"])(
    "picks the option %s, past where the driver reads flags",
    async (option) => {
      const chatId = ChatIdSchema.parse("computer-select-chat");
      const inChat = { ...scope, chatId };
      const driver = standInDriver(answers);
      await grantApp(chatId, "com.apple.TextEdit");
      await snapshot(["TextEdit"], inChat);
      await capabilityRunner("computer", "select")(
        ["@s1abc:e1", option],
        inChat,
      );
      expect(driver.rawCalls().find(([word]) => word === "select")).toEqual([
        "select",
        "@s1abc:e1",
        "--agent-id",
        "instrument",
        "--session",
        "run-stand-in",
        "--",
        option,
      ]);
    },
  );

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

  it("keeps a yes to one name from opening up a program marked Not allowed", async () => {
    const chatId = ChatIdSchema.parse("computer-alias-closed-chat");
    const inChat = { ...scope, chatId };
    standInDriver({
      ...answers,
      launch: ok({ app: "gnome-calculator", pid: 7 }),
      "list-apps": ok({ apps: [] }),
    });
    await updatePermissionSettings((settings) => ({
      ...settings,
      apps: [{ addedAt: new Date(), level: "never", name: "gnome-calculator" }],
    }));
    await grantApp(chatId, "Calculator");
    await expect(open(["Calculator"], inChat)).rejects.toThrow(
      "Calculator started, and runs as gnome-calculator. gnome-calculator is marked Not allowed",
    );
    expect(
      await appLevel(chatId, {
        bundleId: "gnome-calculator",
        name: "gnome-calculator",
      }),
    ).toBe("never");
  });

  it.runIf(process.platform === "linux")(
    "won't start a path on Linux, whose driver would run what's there",
    async () => {
      const chatId = ChatIdSchema.parse("computer-path-chat");
      const inChat = { ...scope, chatId };
      const driver = standInDriver({
        ...answers,
        "list-apps": ok({ apps: [] }),
      });
      await grantApp(chatId, "/tmp/made-by-the-agent");
      await expect(open(["/tmp/made-by-the-agent"], inChat)).rejects.toThrow(
        'No app called "/tmp/made-by-the-agent" is on this computer.',
      );
      expect(driver.actions()).toEqual([]);
    },
  );

  it("lets a yes to the name a person knows cover the name it runs under", async () => {
    const chatId = ChatIdSchema.parse("computer-alias-chat");
    const inChat = { ...scope, chatId };
    const driver = standInDriver({
      ...answers,
      launch: ok({
        app: "gnome-calculator",
        pid: 7,
        window: { id: "w-1.13-org-gnome-Calculator", title: "Calculator" },
      }),
      "list-apps": ok({ apps: [] }),
    });
    await grantApp(chatId, "Calculator");
    const opened = await open(["Calculator"], inChat);
    expect(opened.stdout).toBe(
      'gnome-calculator is running, with window w-1.13-org-gnome-Calculator "Calculator".\n',
    );
    driver.setAnswers({
      ...answers,
      "list-apps": ok({
        apps: [
          {
            bundle_id: "org.gnome.Calculator",
            name: "gnome-calculator",
            pid: 7,
            presentation: "foreground",
          },
        ],
      }),
      "list-windows": ok([
        { accessible: true, id: "w-1.13-org-gnome-Calculator", pid: 7 },
      ]),
    });
    await expect(snapshot(["gnome-calculator"], inChat)).resolves.toMatchObject(
      {
        exitCode: 0,
      },
    );
  });

  it("reports what an action opened, and not the window it was in", async () => {
    const driver = standInDriver({
      ...answers,
      click: ok({
        disposition: { delivery: "delivered_unverified" },
        surfaces: [{ id: "w-1", title: "Calculator", type: "window" }],
      }),
    });
    await grantApp(scope.chatId, "com.apple.TextEdit");
    await snapshot(["TextEdit"], scope);
    expect((await click(["@s1abc:e1"], scope)).stdout).toBe(
      "Done (delivered unverified).\n",
    );
    driver.setAnswers({
      ...answers,
      click: ok({
        disposition: { delivery: "delivered_unverified" },
        surfaces: [
          { id: "w-1", title: "Calculator", type: "window" },
          { id: "m-1", type: "menu" },
        ],
      }),
    });
    expect((await click(["@s1abc:e1"], scope)).stdout).toBe(
      'Done (delivered unverified). It opened: [{"type":"menu","id":"m-1"}]\n',
    );
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

  describe("on Windows", () => {
    const realPlatform = process.platform;
    const calculator = {
      accessible: true,
      app_name: "CalculatorApp.exe",
      id: "w-262330",
      pid: 12_180,
      title: "Calculator",
    };
    const notepad = {
      accessible: true,
      app_name: "Notepad.exe",
      id: "w-197500",
      pid: 1672,
      title: "*Shopping - Notepad",
    };
    const desktop = (windows: unknown[]) => ({
      ...answers,
      // What the driver says of a packaged app: the process that frames it.
      "list-apps": ok({
        apps: [
          {
            name: "ApplicationFrameHost.exe",
            pid: 5364,
            presentation: "foreground",
          },
        ],
      }),
      "list-windows": ok(windows),
    });

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32" });
      startMenu.displayName = undefined;
      startMenu.opened = [];
      startMenu.afterOpening = () => {};
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: realPlatform });
    });

    it("starts reading the Start menu at the first command, ahead of any card", async () => {
      standInDriver(desktop([calculator]));
      startMenu.readAhead = 0;
      await apps([], scope);
      expect(startMenu.readAhead).toBeGreaterThan(0);
    });

    it("asks about a running app under its program, by the name a person knows it by", async () => {
      standInDriver(desktop([calculator]));
      const asked = { bundleId: "CalculatorApp", name: "CalculatorApp" };
      startMenu.displayName = "Calculator";
      for (const given of ["Calculator", "CalculatorApp"]) {
        await expect(appToAskOffMac(given, scope.chatId)).resolves.toEqual({
          ...asked,
          show: "Calculator",
        });
      }
      // Its own process couldn't be looked at, or it doesn't say.
      startMenu.displayName = undefined;
      await expect(appToAskOffMac("Calculator", scope.chatId)).resolves.toEqual(
        { ...asked, show: "CalculatorApp" },
      );
      // Not running, it goes by the name it was given.
      await expect(appToAskOffMac("Paint", scope.chatId)).resolves.toEqual({
        bundleId: "Paint",
        name: "Paint",
        show: "Paint",
      });
    });

    it("lists apps by what their windows say, and not the process framing them", async () => {
      standInDriver(
        desktop([
          calculator,
          notepad,
          { ...notepad, id: "w-328312", title: "Untitled - Notepad" },
          {
            ...notepad,
            app_name: "Instrument Preview (computer-use-170).exe",
            id: "w-525094",
            pid: 5980,
            title: "A chat about Paint",
          },
          {
            ...notepad,
            app_name: "ApplicationFrameHost.exe",
            id: "w-1049634",
            pid: 5364,
            title: "Settings",
          },
        ]),
      );
      expect((await apps([], scope)).stdout).toMatchInlineSnapshot(`
        "Calculator (CalculatorApp): ask first
        Notepad (Notepad): ask first
        "
      `);
    });

    it("finds an app by the name a person knows, and asks about its program", async () => {
      const driver = standInDriver(desktop([calculator]));
      await expect(snapshot(["Calculator"], scope)).rejects.toThrow(
        "using CalculatorApp needs the person's yes",
      );
      await grantApp(scope.chatId, "CalculatorApp");
      await snapshot(["Calculator"], scope);
      expect(driver.actions().at(-1)?.slice(0, 3)).toEqual([
        "snapshot",
        "--window-id",
        "w-262330",
      ]);
    });

    it.each(["CalculatorApp", "CalculatorApp.exe"])(
      "takes the program's name too, as %s, under one yes",
      async (given) => {
        standInDriver(desktop([calculator]));
        await grantApp(scope.chatId, "CalculatorApp");
        await expect(snapshot([given], scope)).resolves.toMatchObject({
          exitCode: 0,
        });
      },
    );

    it("gives another program nothing for a title that says it's an allowed app", async () => {
      const driver = standInDriver(
        desktop([
          {
            ...notepad,
            app_name: "Other.exe",
            id: "w-9",
            pid: 77,
            title: "Budget - Calculator",
          },
        ]),
      );
      await grantApp(scope.chatId, "Calculator");
      await updatePermissionSettings((settings) => ({
        ...settings,
        apps: [{ addedAt: new Date(), level: "allow", name: "Calculator" }],
      }));
      await expect(snapshot(["Calculator"], scope)).rejects.toThrow(
        "using Other needs the person's yes",
      );
      await expect(snapshot(["Other"], scope)).rejects.toThrow(
        "using Other needs the person's yes",
      );
      expect((await apps([], scope)).stdout).toBe(
        "Calculator (Other): ask first\n",
      );
      expect(driver.actions()).toEqual([]);
    });

    it("keeps a yes through a change of title", async () => {
      const driver = standInDriver(desktop([notepad]));
      await grantApp(scope.chatId, "Notepad");
      await snapshot(["Notepad"], scope);
      driver.setAnswers(
        desktop([{ ...notepad, title: "Now playing something" }]),
      );
      await expect(
        snapshot(["Now playing something"], scope),
      ).resolves.toMatchObject({ exitCode: 0 });
    });

    it("never drives this app's windows, whatever their title says", async () => {
      const driver = standInDriver(
        desktop([
          {
            ...notepad,
            app_name: "Instrument.exe",
            id: "w-9",
            pid: 77,
            title: "Calculator",
          },
        ]),
      );
      await grantApp(scope.chatId, "Calculator");
      await expect(snapshot(["Calculator"], scope)).rejects.toThrow(
        "can't drive its own windows",
      );
      expect(driver.actions()).toEqual([]);
    });

    it("never drives the elevation prompt, by its program's whole file name", async () => {
      const driver = standInDriver(
        desktop([
          {
            ...notepad,
            app_name: "consent.exe",
            id: "w-9",
            pid: 77,
            title: "User Account Control",
          },
        ]),
      );
      await grantApp(scope.chatId, "User Account Control");
      await expect(snapshot(["consent"], scope)).rejects.toThrow("only they");
      expect(driver.actions()).toEqual([]);
    });

    it("opens an app from the Start menu and carries the yes to its program", async () => {
      const driver = standInDriver(desktop([notepad]));
      await expect(open(["Calculator"], scope)).rejects.toThrow(
        "using Calculator needs the person's yes",
      );
      expect(startMenu.opened).toEqual([]);
      await grantApp(scope.chatId, "Calculator");
      startMenu.afterOpening = () => {
        driver.setAnswers(
          desktop([
            notepad,
            // Windows frames the window from its host for a moment.
            { ...calculator, app_name: "ApplicationFrameHost.exe", id: "w-1" },
            { ...calculator, app_name: "CalculatorApp.exe", id: "w-2" },
          ]),
        );
      };
      expect((await open(["Calculator"], scope)).stdout).toBe(
        'Calculator is running, with window w-2 "Calculator".\n',
      );
      expect(startMenu.opened).toEqual([
        "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
      ]);
      expect(driver.actions()).toEqual([]);
      driver.setAnswers(desktop([{ ...calculator, title: "Scientific mode" }]));
      await expect(snapshot(["CalculatorApp"], scope)).resolves.toMatchObject({
        exitCode: 0,
      });
    });

    it("doesn't start another copy of a running app", async () => {
      const driver = standInDriver(desktop([calculator]));
      await grantApp(scope.chatId, "CalculatorApp");
      expect((await open(["Calculator"], scope)).stdout).toBe(
        'Calculator is running, with window w-262330 "Calculator".\n',
      );
      expect(startMenu.opened).toEqual([]);
      await open(["Calculator", "--headed"], scope);
      expect(driver.actions()).toEqual([
        ["focus-window", "--window-id", "w-262330"],
      ]);
    });

    it("says what the Start menu has when it hasn't the name asked for", async () => {
      standInDriver(desktop([]));
      await expect(open(["Word"], scope)).rejects.toThrow(
        'No app called "Word" is in the Start menu. It has Microsoft Word.',
      );
      await expect(open(["Nothing Like It"], scope)).rejects.toThrow(
        'No app called "Nothing Like It" is in the Start menu.',
      );
      expect(startMenu.opened).toEqual([]);
    });

    it("says File Explorer can't be driven, without asking about it", async () => {
      standInDriver(desktop([]));
      await grantApp(scope.chatId, "File Explorer");
      await expect(open(["File Explorer"], scope)).rejects.toThrow(
        "part of Windows's own shell",
      );
      expect(startMenu.opened).toEqual([]);
    });

    it("sends keys to a packaged app's window, which is how the driver finds it", async () => {
      const driver = standInDriver(desktop([calculator]));
      await grantApp(scope.chatId, "CalculatorApp");
      await press(["Calculator", "return"], scope);
      expect(driver.actions().at(-1)).toEqual([
        "press",
        "return",
        "--window-id",
        "w-262330",
      ]);
    });
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
