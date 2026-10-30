import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import {
  connectMacApp,
  macAppsStandIn,
} from "../../test/helpers/mac-apps-launch";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { openPermissionAsks } from "../chat/asks";
import { ChatWrites } from "../chat-writes";
import { createLocalBashEnv } from "../create-bash-env";
import { noteMacAppAnswer } from "../permissions/macos";
import { chatDir, sessionOfChat } from "../record-folders";
import { workDir } from "../work-dir";
import { withRaisedAsks } from "../shell-commands/raised-asks";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { readConnection } from "./connection";
import { setUpFromDirectory } from "./set-up";
import { loadApp, readAppGuide } from "./store";

// These are about where a call goes; the guide before a first call is the
// app-call and app-request-guide tests' to cover.
vi.mock("./guide-hand-off", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guide-hand-off")>()),
  anyAppGuideHandedOver: () => true,
  appGuideHandedOver: () => true,
}));

let scratch: string;
let standIn: ReturnType<typeof macAppsStandIn>;
let config: ReturnType<typeof getWorkspaceConfig>;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "mac-apps-"));
});

afterAll(async () => {
  await rm(scratch, { force: true, recursive: true });
});

beforeEach(() => {
  config = getWorkspaceConfig();
  standIn = macAppsStandIn(path.join(scratch, String(Date.now())));
});

afterEach(() => {
  setWorkspaceConfig(config);
  vi.unstubAllGlobals();
});

/**
 * A chat with the Mac apps' stand-in server for the workspace and `server`
 * connected, and what `exec` answers in its shell, with the cards its
 * commands raised. The chat's config is a workspace of its own, so the app
 * is connected once it is made.
 */
async function chatWith(
  name: string,
  server: string,
  more: Partial<ReturnType<typeof getWorkspaceConfig>> = {},
) {
  const chatId = createMockChatConfig(ChatIdSchema.parse(name));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // The stand-in answers for the helper, which is only named here.
    macHelperBinPath: AbsolutePathSchema.parse("/app/bin/instrument-mac"),
    macAppsServer: standIn.launch,
    ...more,
  });
  await mkdir(chatDir(chatId), { recursive: true });
  await mkdir(workDir(chatId), { recursive: true });
  await connectMacApp(getWorkspaceConfig().appsDir, server);
  // The chat's own session, whose log a card is written to.
  const sessionId = sessionOfChat(chatId) ?? StoreId.newSessionId();
  await ChatWrites.saveSession(
    { createdAt: new Date(), id: sessionId, title: name },
    chatId,
  );
  return {
    chatId,
    exec: async (command: string) => {
      const bash = await createLocalBashEnv({
        chatId,
        role: "chat",
        sessionId,
      });
      const asks: string[] = [];
      const result = await withRaisedAsks(asks, () => bash.exec(command));
      return { asks, result };
    },
  };
}

describe("a call to a Mac app", () => {
  it("goes to the app's own server and answers its tool's text", async () => {
    const chat = await chatWith("mac-app-reminder", "apple-reminders");
    const { asks, result } = await chat.exec(
      `instrument app call apple-reminders add_reminder '{"title": "Call the roofer", "due": "tomorrow"}'`,
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      reminder: { list: "Reminders", title: "Call the roofer" },
    });
    expect(asks).toEqual([]);
    expect(standIn.calls()).toEqual([
      {
        helper: [
          "add-reminder",
          "--due",
          "tomorrow",
          "--title",
          "Call the roofer",
        ],
        server: "apple-reminders",
      },
    ]);
  }, 30_000);

  // The denial the server names is macOS's own, so it becomes the card
  // that opens the setting, and the bash call ends the turn on it.
  it("raises the macOS card when macOS refuses, and exits 2", async () => {
    // macOS can't say ahead of the call, as for an app it answers about
    // only while it runs, so the call is what finds out.
    const chat = await chatWith("mac-app-refused", "apple-calendar", {
      macAppAccess: () => Promise.resolve("unknown"),
    });
    standIn.refuse(["apple-calendar"]);
    const { asks, result } = await chat.exec(
      `instrument app call apple-calendar add_event '{"title": "Dinner with Sam", "start": "2026-11-06T19:00"}'`,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "macOS itself keeps Instrument out of Calendar",
    );
    const cards = await openPermissionAsks(chat.chatId);
    expect(cards).toMatchObject([
      { kind: "app", status: "macos-refused", target: "Calendar" },
    ]);
    expect(asks).toEqual(cards.map((card) => card.id));
    // A second call, as a script that caught the first one makes, meets
    // macOS's last answer, joins the card that is up and reaches nothing.
    const again = await chat.exec(
      `instrument app call apple-calendar list_calendars '{}'`,
    );
    expect(again.result.exitCode).toBe(2);
    expect(again.asks).toEqual(asks);
    expect(standIn.calls()).toHaveLength(1);
    noteMacAppAnswer(
      { bundleId: "com.apple.iCal", name: "Calendar" },
      "allowed",
    );
  }, 30_000);

  // A script meets the same card through the dispatcher's card kind, and
  // its bash call ends the turn on it, whatever the script does after.
  it("hands a script CardShown when macOS refuses", async () => {
    const chat = await chatWith("mac-app-script-refused", "apple-calendar", {
      macAppAccess: () => Promise.resolve("unknown"),
    });
    standIn.refuse(["apple-calendar"]);
    const { asks, result } = await chat.exec(
      `node -e 'instrument.apps["apple-calendar"].add_event({ title: "Lunch", start: "today" }).catch((error) => console.log(error.name))'`,
    );
    expect(result.stdout).toBe("CardShown\n");
    expect(asks).toHaveLength(1);
    noteMacAppAnswer(
      { bundleId: "com.apple.iCal", name: "Calendar" },
      "allowed",
    );
  }, 30_000);

  // macOS saying no before anything runs is the same card, and nothing
  // reaches the server.
  it("raises the card before the call when macOS already says no", async () => {
    const chat = await chatWith("mac-app-standing", "apple-contacts", {
      macAppAccess: () => Promise.resolve("denied"),
    });
    const { asks, result } = await chat.exec(
      `instrument app call apple-contacts search_contacts '{"search": "Maya"}'`,
    );
    expect(result.exitCode).toBe(2);
    expect(asks).toHaveLength(1);
    expect(standIn.calls()).toEqual([]);
    noteMacAppAnswer(
      { bundleId: "com.apple.AddressBook", name: "Contacts" },
      "allowed",
    );
  }, 30_000);

  // Mail reads an attachment outside every sandbox, so the path is held to
  // the chat's folders first and handed over whole.
  it("hands Mail a file the chat may read, by its full path", async () => {
    const chat = await chatWith("mac-app-attach", "apple-mail");
    const file = path.join(workDir(chat.chatId), "plan.pdf");
    await writeFile(file, "%PDF");
    const { result } = await chat.exec(
      `instrument app call apple-mail draft_message '{"to": ["sam@example.com"], "attachments": ["plan.pdf"]}'`,
    );
    expect(result.stderr).toBe("");
    expect(standIn.calls()[0]?.values?.slice(-2)).toEqual(["1", file]);
  }, 30_000);

  // Mac apps run only on macOS, so the refusal is checked against its rules.
  it.runIf(process.platform === "darwin")(
    "refuses a file outside the chat's folders before anything runs",
    async () => {
      const chat = await chatWith("mac-app-attach-refused", "apple-mail");
      const args = JSON.stringify({
        attachments: [path.join(os.homedir(), ".ssh", "id_ed25519")],
        body: "Here",
        to: ["sam@example.com"],
      });
      const { result } = await chat.exec(
        `instrument app call apple-mail send_message '${args}'`,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Permission denied");
      expect(standIn.calls()).toEqual([]);
    },
    30_000,
  );
});

describe("connecting a Mac app from the directory", () => {
  it("writes its folder under the Mac app's name, waiting on the go-ahead", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    createMockChatConfig(ChatIdSchema.parse("mac-app-set-up"));
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      macAppsServer: standIn.launch,
    });
    const set = await setUpFromDirectory({ slug: "apple-notes" });
    expect(set).toEqual({ kind: "set-up", slug: "apple-notes" });
    const app = (
      await loadApp(getWorkspaceConfig().appsDir, "apple-notes")
    )._unsafeUnwrap();
    expect(app.name).toBe("Notes");
    expect(app.manifest).toMatchObject({
      macApp: "com.apple.Notes",
      package: "apple-notes",
      runtime: "bundled",
      type: "mcp-local",
    });
    expect((await readConnection("apple-notes"))?.status).toBe(
      "needs-approval",
    );
    const guide = await readAppGuide(app.dir);
    expect(guide).toContain(
      "- create_note(account?, body?, folder?, title?): Make a new note.",
    );
    expect(guide).toContain(
      "`instrument app call apple-notes <tool> '<json>'`",
    );
    // A second Connect finds the one already there.
    expect(await setUpFromDirectory({ slug: "apple-notes" })).toEqual(set);
  });

  it("hands the agent a Mac app this computer can't run", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      macAppsServer: standIn.launch,
    });
    expect(await setUpFromDirectory({ slug: "apple-mail" })).toEqual({
      kind: "agent",
    });
  });
});
