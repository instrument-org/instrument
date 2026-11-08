import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setChatModel } from "../../lib/chat-settings";
import { publisher } from "../publisher";
import { appRefusal } from "../../lib/permissions/apps";
import {
  appendAnswer,
  changeAsk,
  closeAsksOf,
  openPermissionAsks,
  recordAsk,
} from "../../lib/chat/asks";
import { driveAsks, driveOwedAsks } from "../../lib/chat/drive-asks";
import { chatGrants } from "../../lib/chat/grants";
import { openAsks } from "../../lib/chat/open-asks";
import {
  ChatRecords,
  installChatRecords,
  writingChatRecords,
} from "../../lib/records/chat-records";
import { writeDeviceFile } from "../../lib/records/device-file";
import { newDeviceId } from "../../lib/records/device-id";
import { workspaceLayout } from "../../lib/workspace-layout";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type PermissionDecision } from "../../schemas/ask";
import { chatDenials } from "../../lib/permissions/denials";
import {
  readPermissionSettings,
  updateChatPermissions,
} from "../../lib/permissions/rules";
import { chatDir, sessionOfChat } from "../../lib/record-folders";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { type WorkspaceRPCContext } from "../base";
import { permissions } from "./permissions";

// What macOS answers a look inside a folder, which a test sets.
const macos = vi.hoisted(() => ({
  look: undefined as
    | undefined
    | (() => Promise<"account" | "missing" | "open" | "system">),
}));
vi.mock(import("../../lib/chat/folder-look"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    listFolder: (folderPath: string) =>
      macos.look ? macos.look() : original.listFolder(folderPath),
  };
});

// What a wake waits on to find the chat's model, which a test may hold.
const modelGate = vi.hoisted(() => ({
  wait: () => Promise.resolve(),
}));

// A write a test makes fail, by what it is about.
const failing = vi.hoisted(() => ({
  denial: false,
  grant: undefined as string | undefined,
}));
vi.mock(import("../../lib/permissions/denials"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    setDenied: async (...args: Parameters<typeof original.setDenied>) => {
      if (failing.denial) {
        throw new Error("permissions.json could not be written");
      }
      return original.setDenied(...args);
    },
  };
});
vi.mock(import("../../lib/chat/grants"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    grantFolder: async (...args: Parameters<typeof original.grantFolder>) => {
      if (args[0].path === failing.grant) {
        throw new Error(`could not grant ${args[0].path}`);
      }
      return original.grantFolder(...args);
    },
  };
});

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () =>
    modelGate.wait().then(() => ({ ok: true, value: {} }) as never),
}));

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // These routes never read the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

// A workspace of its own for each test, and this computer's folder for it,
// where the folder rules are kept.
beforeEach(() => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "permissions-route-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    workspaceMachineDir: AbsolutePathSchema.parse(`${rootDir}-machine`),
  });
});

it("sets a place, not a folder, for a folder that is a place on its own", async () => {
  await call(
    permissions.setFolder,
    {
      level: "allow",
      path: AbsolutePathSchema.parse(path.join(os.homedir(), "Documents")),
    },
    { context: createContext() },
  );
  const settings = await readPermissionSettings();
  expect(settings.places.documents).toBe("allow");
  expect(settings.folders).toEqual([]);
});

it("keeps a folder rule for a folder inside a place", async () => {
  const folder = AbsolutePathSchema.parse(
    path.join(os.homedir(), "Documents", "Taxes"),
  );
  await call(
    permissions.setFolder,
    { level: "allow", path: folder },
    { context: createContext() },
  );
  const settings = await readPermissionSettings();
  expect(settings.places.documents).toBeUndefined();
  expect(settings.folders.map((f) => f.path)).toEqual([folder]);
});

it("resets every rule, and what every chat was allowed, to a new install's", async () => {
  const context = { context: createContext() };
  await call(
    permissions.setFolder,
    {
      level: "allow",
      path: AbsolutePathSchema.parse(
        path.join(os.homedir(), "Documents", "Taxes"),
      ),
    },
    context,
  );
  await call(permissions.setPlace, { id: "desktop", level: "allow" }, context);
  await call(permissions.setApp, { level: "allow", name: "Notes" }, context);
  await call(
    permissions.setDangerouslyAllowEveryFolder,
    { dangerouslyAllowEveryFolder: true },
    context,
  );
  await updateChatPermissions("2026-10-19-pantry", (held) => ({
    ...held,
    denials: [
      { deniedAt: new Date(), kind: "folder", target: "/Users/me/Pantry" },
    ],
  }));

  await call(permissions.reset, undefined, context);

  expect(await readPermissionSettings()).toEqual({
    apps: [],
    chats: {},
    projects: {},
    dangerouslyAllowEveryFolder: false,
    folders: [],
    places: {},
  });
});

it("says the rules are untouched until one differs from a new install's", async () => {
  const context = { context: createContext() };
  const untouched = async () =>
    (await call(permissions.get, undefined, context)).untouched;

  expect(await untouched()).toBe(true);
  await call(permissions.setPlace, { id: "desktop", level: "allow" }, context);
  expect(await untouched()).toBe(false);
  await call(permissions.setPlace, { id: "desktop", level: "ask" }, context);
  expect(await untouched()).toBe(true);
  await updateChatPermissions("2026-10-19-pantry", (held) => ({
    ...held,
    denials: [
      { deniedAt: new Date(), kind: "folder", target: "/Users/me/Pantry" },
    ],
  }));
  expect(await untouched()).toBe(false);
});

describe("permissions.answer", () => {
  const sent: {
    type: string;
    value: { message?: SessionMessage.UserWithParts; sessionId?: string };
  }[] = [];
  const context = () => ({
    workspaceConfig: getWorkspaceConfig(),
    // A wake reads only `send`, which hands a session its note, so the cast
    // spares the test a workspace machine.
    workspaceRef: {
      send: (event: (typeof sent)[number]) => {
        sent.push(event);
      },
    } as unknown as WorkspaceActorRef,
  });

  /** Each session woken since the `before`th event, with the answer it got. */
  function wokenSince(before: number) {
    return sent
      .slice(before)
      .filter((event) => event.type === "addMessage")
      .map((event) => ({
        answer: event.value.message?.parts.flatMap((part) =>
          part.type === "data-permissionAnswer" ? [part.data.answer] : [],
        ),
        sessionId: event.value.sessionId,
      }));
  }

  /** A chat someone has written in, with one task. */
  async function chatWithTask() {
    const chatId = await chatFor(StoreId.newSessionId());
    const written = await setChatModel(
      chatId,
      AIGatewayModelURI.Schema.parse(
        "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
      ),
    );
    if (written.isErr()) {
      throw written.error;
    }
    const own = sessionOfChat(chatId);
    if (!own) {
      throw new Error("expected the chat's session");
    }
    const task = await chatTaskFor(chatId, { title: "Stock the pantry" });
    return { chatId, own, task };
  }

  it("wakes every session that asked on the card", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    const cards = await openAsks(chatId);
    expect(cards).toHaveLength(1);
    const sentBefore = sent.length;

    await call(
      permissions.answer,
      { askId: cards[0]?.id ?? "", decision: "allowed", id: chatId },
      { context: context() },
    );

    const woken = wokenSince(sentBefore);
    expect(woken).toHaveLength(2);
    expect(woken).toEqual(
      expect.arrayContaining([
        { answer: ["allowed"], sessionId: own },
        { answer: ["allowed"], sessionId: task },
      ]),
    );
    expect(await openAsks(chatId)).toEqual([]);
  });

  it("records one denial for the chat when the person says not now to a card two sessions asked on", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    const [card] = await openAsks(chatId);
    const sentBefore = sent.length;

    await call(
      permissions.answer,
      { askId: card?.id ?? "", decision: "declined", id: chatId },
      { context: context() },
    );

    expect(await chatDenials(chatId)).toEqual([
      {
        deniedAt: expect.any(Date),
        kind: "folder",
        target: "/Users/me/Pantry",
      },
    ]);
    const woken = wokenSince(sentBefore);
    expect(woken).toHaveLength(2);
    expect(woken).toEqual(
      expect.arrayContaining([
        { answer: ["declined"], sessionId: own },
        { answer: ["declined"], sessionId: task },
      ]),
    );
  });

  // No test for a card written in the old shape. The stored key is `asks`
  // now and its entries carry `askers`, where a card used to carry one
  // `partId` and `sessionId`; nothing reads the old shape, deliberately, so a
  // card left unanswered across the update is asked again rather than
  // migrated. Two installs have one, and asking twice costs less than a shim.

  // The card names an app as its command asked for it, and an Always allow
  // keeps that name, which is how Settings › Permissions lists the app; it
  // then holds in every chat, and "Allow in this chat" in this one only.
  it.each([
    ["Calendar", "com.apple.iCal"],
    ["Reminders", "com.apple.reminders"],
    ["Contacts", "com.apple.AddressBook"],
    ["Mail", "com.apple.mail"],
    ["Notes", "com.apple.Notes"],
    ["Messages", "com.apple.MobileSMS"],
  ])(
    "lists %s in Settings by the card's name once allowed always",
    async (name, bundleId) => {
      const app = { bundleId, name };
      const here = await chatWithTask();
      const elsewhere = await chatWithTask();
      await recordAsk(
        { chatId: here.chatId, sessionId: here.own },
        "app",
        name,
      );
      const [card] = await openAsks(here.chatId);

      await call(
        permissions.answer,
        { askId: card?.id ?? "", decision: "always", id: here.chatId },
        { context: context() },
      );

      expect((await readPermissionSettings()).apps).toEqual([
        expect.objectContaining({ level: "allow", name }),
      ]);
      expect(await appRefusal(here.chatId, app, undefined)).toBeUndefined();
      expect(
        await appRefusal(elsewhere.chatId, app, undefined),
      ).toBeUndefined();
    },
  );

  it("allows an app in the asking chat only, without listing it in Settings", async () => {
    const app = { bundleId: "com.apple.AddressBook", name: "Contacts" };
    const here = await chatWithTask();
    const elsewhere = await chatWithTask();
    await recordAsk(
      { chatId: here.chatId, sessionId: here.own },
      "app",
      "Contacts",
    );
    const [card] = await openAsks(here.chatId);

    await call(
      permissions.answer,
      { askId: card?.id ?? "", decision: "allowed", id: here.chatId },
      { context: context() },
    );

    expect((await readPermissionSettings()).apps).toEqual([]);
    expect(await appRefusal(here.chatId, app, undefined)).toBeUndefined();
    expect(await appRefusal(elsewhere.chatId, app, undefined)).toBe(
      "using Contacts needs the person's yes first.",
    );
  });
  it("wakes the askers of a declined card when the refusal cannot be kept", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    const [card] = await openAsks(chatId);
    const sentBefore = sent.length;
    failing.denial = true;

    try {
      await call(
        permissions.answer,
        { askId: card?.id ?? "", decision: "declined", id: chatId },
        { context: context() },
      );
    } finally {
      failing.denial = false;
    }

    expect(await openAsks(chatId)).toEqual([]);
    expect(wokenSince(sentBefore)).toEqual(
      expect.arrayContaining([
        { answer: ["declined"], sessionId: own },
        { answer: ["declined"], sessionId: task },
      ]),
    );
  });

  it("answers a card by its own outcome when another card taken with it fails", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Cellar");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    const cards = await openPermissionAsks(chatId);
    const cellar = cards.find((card) => card.target === "/Users/me/Cellar");
    const pantry = cards.find((card) => card.target === "/Users/me/Pantry");
    // Another device's yes to the cellar, not taken yet when the person
    // answers the pantry, so one look takes both.
    await appendAnswer(chatId, cellar?.id ?? "", {
      decision: "allowed",
      kind: "permission",
    });
    failing.grant = "/Users/me/Cellar";
    const sentBefore = sent.length;

    try {
      await call(
        permissions.answer,
        { askId: pantry?.id ?? "", decision: "allowed", id: chatId },
        { context: context() },
      );
    } finally {
      failing.grant = undefined;
    }

    expect(wokenSince(sentBefore)).toEqual([
      { answer: ["allowed"], sessionId: own },
    ]);
    expect(
      (await openPermissionAsks(chatId)).map((card) => card.target),
    ).toEqual(["/Users/me/Cellar"]);
  });

  it("says not now to every card at once", async () => {
    const { chatId, own } = await chatWithTask();
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "app", "Contacts");

    await call(permissions.declineAll, { id: chatId }, { context: context() });

    expect(await openAsks(chatId)).toEqual([]);
    expect((await chatDenials(chatId)).map((denial) => denial.target)).toEqual(
      expect.arrayContaining(["/Users/me/Pantry", "Contacts"]),
    );
  });

  it("retries only a card macOS refused", async () => {
    const { chatId, own } = await chatWithTask();
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    const [card] = await openAsks(chatId);
    await expect(
      call(
        permissions.retry,
        { askId: card?.id ?? "", id: chatId },
        { context: context() },
      ),
    ).rejects.toThrow("That request isn't waiting on the system.");
  });

  describe.runIf(process.platform === "darwin")("on macOS", () => {
    afterEach(() => {
      macos.look = undefined;
    });

    /** Whether macOS's prompt is on screen, as the window list would say. */
    const promptShown = (onScreen: boolean) => {
      setWorkspaceConfig({
        ...getWorkspaceConfig(),
        macosPromptOnScreen: () => Promise.resolve(onScreen),
      });
    };

    it("says macOS is asking while its prompt is up, then settles on the answer", async () => {
      const { chatId, own } = await chatWithTask();
      const desktop = path.join(os.homedir(), "Desktop", "Pantry");
      await recordAsk({ chatId, sessionId: own }, "folder", desktop);
      promptShown(true);
      const [card] = await openAsks(chatId);
      let answerMacos: (look: "system") => void = () => {};
      macos.look = () =>
        new Promise((resolve) => {
          answerMacos = resolve;
        });

      const allowing = call(
        permissions.answer,
        { askId: card?.id ?? "", decision: "allowed", id: chatId },
        { context: context() },
      );
      await vi.waitFor(
        async () => {
          expect(await openAsks(chatId)).toEqual([
            expect.objectContaining({ status: "macos-asking" }),
          ]);
        },
        { timeout: 3000 },
      );
      answerMacos("system");
      await allowing;

      expect(await openAsks(chatId)).toEqual([
        expect.objectContaining({ status: "macos-refused" }),
      ]);
    });

    it.each([
      ["no prompt seen", false],
      // Another app's alert on screen while the look waits on a slow folder.
      ["another alert on screen", true],
    ])(
      "lets a command's asking card go quietly when its look gets in with %s",
      async (_name, onScreen) => {
        const { chatId, own } = await chatWithTask();
        const downloads = path.join(os.homedir(), "Downloads");
        // What a command's watch records once a prompt showed.
        await recordAsk(
          { chatId, sessionId: own, waits: true },
          "folder",
          downloads,
          { allowed: "allowed", status: "macos-asking" },
        );
        const [card] = await openAsks(chatId);
        const sentBefore = sent.length;
        promptShown(onScreen);
        macos.look = () =>
          new Promise((resolve) => setTimeout(() => resolve("open"), 600));

        await call(
          permissions.retry,
          { askId: card?.id ?? "", id: chatId },
          { context: context() },
        );

        expect(await openAsks(chatId)).toEqual([]);
        expect(wokenSince(sentBefore)).toEqual([]);
      },
    );

    it("wakes an asking card's asker whose call ended its turn, even when the answer came before the look", async () => {
      const { chatId, own } = await chatWithTask();
      const downloads = path.join(os.homedir(), "Downloads");
      // What ask_permission records once macOS's prompt showed.
      await recordAsk({ chatId, sessionId: own }, "folder", downloads, {
        allowed: "allowed",
        status: "macos-asking",
      });
      const [card] = await openAsks(chatId);
      const sentBefore = sent.length;
      // The person already answered the prompt, so the look gets in at once.
      promptShown(false);
      macos.look = () => Promise.resolve("open");

      await call(
        permissions.retry,
        { askId: card?.id ?? "", id: chatId },
        { context: context() },
      );

      expect(await openAsks(chatId)).toEqual([]);
      expect(wokenSince(sentBefore)).toEqual([
        { answer: ["allowed"], sessionId: own },
      ]);
    });

    it("says a folder only its own app opens is private, with no way in", async () => {
      const { chatId, own } = await chatWithTask();
      await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
      const [card] = await openAsks(chatId);
      macos.look = () => Promise.resolve("system");

      await call(
        permissions.answer,
        { askId: card?.id ?? "", decision: "allowed", id: chatId },
        { context: context() },
      );

      expect(await openAsks(chatId)).toEqual([
        expect.objectContaining({ status: "macos-private" }),
      ]);
    });

    it("keeps a folder macOS refuses open with the yes, and wakes the askers once a retry gets in", async () => {
      const { chatId, own } = await chatWithTask();
      const desktop = path.join(os.homedir(), "Desktop", "Pantry");
      await recordAsk({ chatId, sessionId: own }, "folder", desktop);
      const [card] = await openAsks(chatId);
      const sentBefore = sent.length;
      macos.look = () => Promise.resolve("system");

      await call(
        permissions.answer,
        { askId: card?.id ?? "", decision: "always", id: chatId },
        { context: context() },
      );

      expect(await openAsks(chatId)).toEqual([
        expect.objectContaining({ allowed: "always", status: "macos-refused" }),
      ]);
      expect(wokenSince(sentBefore)).toEqual([]);

      macos.look = () => Promise.resolve("open");
      await call(
        permissions.retry,
        { askId: card?.id ?? "", id: chatId },
        { context: context() },
      );

      expect(await openAsks(chatId)).toEqual([]);
      expect(wokenSince(sentBefore)).toEqual([
        { answer: ["always"], sessionId: own },
      ]);
    });

    it("joins an Allow from another window to the look already running", async () => {
      const { chatId, own, task } = await chatWithTask();
      await recordAsk(
        { chatId, sessionId: task },
        "folder",
        "/Users/me/Pantry",
      );
      await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
      const [card] = await openAsks(chatId);
      const sentBefore = sent.length;
      let answerMacos: (look: "open") => void = () => {};
      let looks = 0;
      macos.look = () => {
        looks++;
        return new Promise((resolve) => {
          answerMacos = resolve;
        });
      };
      const allow = () =>
        call(
          permissions.answer,
          { askId: card?.id ?? "", decision: "allowed", id: chatId },
          { context: context() },
        );

      const first = allow();
      const second = allow();
      await vi.waitFor(() => {
        expect(looks).toBe(1);
      });
      answerMacos("open");
      await Promise.all([first, second]);

      expect(wokenSince(sentBefore)).toHaveLength(2);
      expect(await openAsks(chatId)).toEqual([]);
    });

    it("wakes with only the not now given while macOS was still asking", async () => {
      const { chatId, own } = await chatWithTask();
      await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
      const [card] = await openAsks(chatId);
      const sentBefore = sent.length;
      let answerMacos: (look: "open") => void = () => {};
      let asking = false;
      macos.look = () =>
        new Promise((resolve) => {
          asking = true;
          answerMacos = resolve;
        });

      const allowed = call(
        permissions.answer,
        { askId: card?.id ?? "", decision: "allowed", id: chatId },
        { context: context() },
      );
      await vi.waitFor(() => {
        expect(asking).toBe(true);
      });
      await call(
        permissions.answer,
        { askId: card?.id ?? "", decision: "declined", id: chatId },
        { context: context() },
      );
      answerMacos("open");
      await allowed;

      expect(wokenSince(sentBefore)).toEqual([
        { answer: ["declined"], sessionId: own },
      ]);
    });
  });

  // Every device writes its own logs into one synced folder; here each is
  // a `ChatRecords` of its own over the same chats folder, and the one in
  // place is the device the call runs on.
  describe("from another computer", () => {
    const owner = () => {
      const records = writingChatRecords();
      if (!records) {
        throw new Error("expected the test's records in place");
      }
      return records;
    };
    const made: ChatRecords[] = [];
    afterEach(async () => {
      await Promise.all(made.splice(0).map((records) => records.dispose()));
    });

    /** A device with a name, its records over the same chats folder. */
    async function computer(
      name: string,
      device = newDeviceId(),
      now?: () => Date,
    ) {
      await writeDeviceFile({
        device,
        devicesDir: workspaceLayout(getWorkspaceConfig().rootDir).devicesDir,
        file: { name, platform: "darwin" },
      });
      if (device === owner().device) {
        return owner();
      }
      const records = new ChatRecords({
        app: "0.0.0-test",
        device,
        dirOf: chatDir,
        fsync: false,
        ...(now && { now }),
      });
      made.push(records);
      return records;
    }

    /**
     * Runs `act` as the device `records` writes for, once it has read what
     * the others wrote, then puts the owner back.
     */
    async function on<T>(records: ChatRecords, act: () => Promise<T>) {
      const home = owner();
      await records.catchUp(chatIdNow);
      installChatRecords(records);
      try {
        return await act();
      } finally {
        installChatRecords(home);
      }
    }
    let chatIdNow = ChatIdSchema.parse("unset");

    /** A folder card raised on the owner, "Studio Mac", which a phone and a laptop see. */
    async function raised() {
      const ref = await chatWithTask();
      chatIdNow = ref.chatId;
      await computer("Studio Mac", owner().device);
      const pantry = "/Users/me/Pantry";
      await recordAsk(
        { chatId: ref.chatId, reason: "To stock it.", sessionId: ref.task },
        "folder",
        pantry,
      );
      const [card] = await openAsks(ref.chatId);
      if (!card || card.kind === "question") {
        throw new Error("expected the folder's card");
      }
      return { ...ref, card, pantry };
    }

    const answer = (
      chatId: ChatId,
      askId: string,
      decision: PermissionDecision,
    ) =>
      call(
        permissions.answer,
        { askId, decision, id: chatId },
        { context: context() },
      );

    it("shows the owner's card elsewhere, answerable and named for its computer", async () => {
      const { card, chatId } = await raised();
      const phone = await computer("Jeremy's iPhone");

      expect(await on(phone, () => openAsks(chatId))).toEqual([
        expect.objectContaining({
          answerable: true,
          computer: "Studio Mac",
          here: false,
          id: card.id,
          status: "open",
        }),
      ]);
    });

    it("takes the first answer in log order, and the grant is the owner's", async () => {
      const { card, chatId, own, pantry, task } = await raised();
      const phone = await computer("Jeremy's iPhone");
      const laptop = await computer("MacBook Air");
      await on(phone, () => answer(chatId, card.id, "always"));
      // The laptop's no lands after it, as one given before the phone's had
      // synced there would.
      await laptop.catchUp(chatId);
      await laptop.answer(chatId, own, {
        ask: card.id,
        given: { decision: "declined", kind: "permission" },
      });
      const sentBefore = sent.length;
      // The owner hears both arrive.
      await owner().catchUp(chatId);
      await driveAsks(chatId, context().workspaceRef);

      expect(await chatGrants(chatId)).toEqual([
        expect.objectContaining({ path: pantry }),
      ]);
      expect((await readPermissionSettings()).folders).toEqual([
        expect.objectContaining({ level: "allow", path: pantry }),
      ]);
      expect(wokenSince(sentBefore)).toEqual([
        { answer: ["always"], sessionId: task },
      ]);
      expect(await openAsks(chatId)).toEqual([]);
      expect(await on(laptop, () => openAsks(chatId))).toEqual([]);
    });

    it("refuses a later answer once one is given, and shows it waiting for the owner", async () => {
      const { card, chatId } = await raised();
      const phone = await computer("Jeremy's iPhone");
      const laptop = await computer("MacBook Air");
      await on(phone, () => answer(chatId, card.id, "allowed"));
      // The owner is off: nothing takes the answer yet.

      await expect(
        on(laptop, () => answer(chatId, card.id, "declined")),
      ).rejects.toThrow("That request was already answered.");
      expect(await on(laptop, () => openAsks(chatId))).toEqual([
        expect.objectContaining({
          answerable: false,
          answered: {
            by: "Jeremy's iPhone",
            decision: "allowed",
            taken: false,
          },
          computer: "Studio Mac",
        }),
      ]);
    });

    it("refuses a card only the owner's screen can answer, naming the owner", async () => {
      const { chatId, own } = await chatWithTask();
      chatIdNow = chatId;
      await computer("Studio Mac", owner().device);
      await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Work", {
        allowed: "allowed",
        programs: ["C:\\Program Files\\Instrument\\Instrument.exe"],
        status: "windows-blocked",
      });
      const [card] = await openAsks(chatId);
      const phone = await computer("Jeremy's iPhone");

      expect(await on(phone, () => openAsks(chatId))).toEqual([
        expect.objectContaining({ answerable: false, here: false }),
      ]);
      await expect(
        on(phone, () => answer(chatId, card?.id ?? "", "allowed")),
      ).rejects.toThrow("That request needs answering on Studio Mac.");
    });

    it.runIf(process.platform === "darwin")(
      "keeps a remote yes that macOS then refuses, as needing the owner",
      async () => {
        const { card, chatId } = await raised();
        const phone = await computer("Jeremy's iPhone");
        macos.look = () => Promise.resolve("system");
        await on(phone, () => answer(chatId, card.id, "allowed"));

        await owner().catchUp(chatId);
        await driveAsks(chatId, context().workspaceRef);
        macos.look = undefined;

        expect(await on(phone, () => openAsks(chatId))).toEqual([
          expect.objectContaining({
            answerable: false,
            answered: {
              by: "Jeremy's iPhone",
              decision: "allowed",
              taken: true,
            },
            computer: "Studio Mac",
            status: "macos-private",
          }),
        ]);
      },
    );

    it("closes the card in the records when the owner stops the session", async () => {
      const { chatId, task } = await raised();
      const phone = await computer("Jeremy's iPhone");

      await closeAsksOf(chatId, task);

      expect(await on(phone, () => openAsks(chatId))).toEqual([]);
    });

    // The app quit, or crashed, after noting the answer on the card and
    // before granting it: the next pass, as a launch makes, finishes it.
    it("finishes an answer it took but never carried out", async () => {
      const { card, chatId, pantry, task } = await raised();
      const phone = await computer("Jeremy's iPhone");
      await on(phone, () => answer(chatId, card.id, "allowed"));
      await owner().catchUp(chatId);
      const [given] = await openAsks(chatId);
      const taken =
        given?.kind === "question" ? undefined : given?.answered?.taken;
      expect(taken).toBe(false);
      // What the quit left: the answer on the card, nothing granted.
      await changeAsk(chatId, card.id, ({ ask, pending }) =>
        pending
          ? { ...ask, stage: { answer: pending, is: "taken" } }
          : undefined,
      );
      expect(await chatGrants(chatId)).toEqual([]);
      const sentBefore = sent.length;

      await driveAsks(chatId, context().workspaceRef);

      expect(await chatGrants(chatId)).toEqual([
        expect.objectContaining({ path: pantry }),
      ]);
      expect(wokenSince(sentBefore)).toEqual([
        { answer: ["allowed"], sessionId: task },
      ]);
      expect(await openAsks(chatId)).toEqual([]);
    });

    it("leaves a card it could not carry out up and answerable, saying why", async () => {
      const { chatId, own } = await chatWithTask();
      chatIdNow = chatId;
      await computer("Studio Mac", owner().device);
      // A target no folder rule can be written for.
      await recordAsk({ chatId, sessionId: own }, "folder", "not/a/full/path");
      const [card] = await openAsks(chatId);
      const phone = await computer("Jeremy's iPhone");
      await on(phone, () => answer(chatId, card?.id ?? "", "always"));
      await owner().catchUp(chatId);

      await driveAsks(chatId, context().workspaceRef);

      const [after] = await on(phone, () => openAsks(chatId));
      expect(after).toMatchObject({
        answerable: true,
        failed: { decision: "always", message: expect.any(String) },
      });
      expect(after).not.toHaveProperty("answered");
      // Answered again, the next answer is taken.
      await on(phone, () => answer(chatId, card?.id ?? "", "declined"));
      await owner().catchUp(chatId);
      await driveAsks(chatId, context().workspaceRef);
      expect(await openAsks(chatId)).toEqual([]);
    });

    // The write of the owner's own answer wakes the watcher, which may take
    // it first; the call still waits for the window to say where the page is.
    it("settles the owner's own answer with the watcher running", async () => {
      const { chatId, own } = await chatWithTask();
      chatIdNow = chatId;
      const tab = StoreId.newTabId();
      await recordAsk({ chatId, sessionId: own }, "page", tab, {
        page: { title: "Cart", url: "https://example.com/cart" },
      });
      const [card] = await openAsks(chatId);
      let moveTab: (() => void) | undefined;
      const stopWindow = publisher.subscribe("window.tab", (ask) => {
        moveTab = () => {
          publisher.publish("window.tabDone", {
            id: ask.id,
            requestId: ask.requestId,
            tabs: [
              {
                id: tab,
                kind: "page",
                title: "Cart",
                url: "https://example.com/cart",
              },
            ],
          });
        };
      });
      const stopWatcher = publisher.subscribe(
        "record.changed",
        ({ id, kind }) => {
          if (id === chatId && kind === "session") {
            driveAsks(chatId, context().workspaceRef).catch(() => undefined);
          }
        },
      );
      try {
        let settled = false;
        const answering = answer(chatId, card?.id ?? "", "allowed").then(() => {
          settled = true;
        });
        // The window was asked where the page is, and has not said yet.
        await vi.waitFor(() => {
          expect(moveTab).toBeDefined();
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(settled).toBe(false);
        moveTab?.();
        await answering;
        expect(settled).toBe(true);
      } finally {
        stopWindow();
        stopWatcher();
      }
    });

    /** A clock as it read half an hour ago, past when an answer stays fresh. */
    const halfAnHourAgo = () => new Date(Date.now() - 30 * 60 * 1000);

    it("never takes an answer given while it was away, and asks again", async () => {
      const { card, chatId, own, task } = await raised();
      const phone = await computer("Jeremy's iPhone", undefined, halfAnHourAgo);
      await on(phone, () => answer(chatId, card.id, "allowed"));
      const sentBefore = sent.length;
      const ours = ({ sessionId }: { sessionId?: string }) =>
        sessionId === own || sessionId === task;

      // What a launch does: drive every chat something is owed on.
      await owner().catchUp(chatId);
      await driveOwedAsks(context().workspaceRef);

      expect(await chatGrants(chatId)).toEqual([]);
      expect(wokenSince(sentBefore).filter(ours)).toEqual([]);
      const laptop = await computer("MacBook Air");
      expect(await on(laptop, () => openAsks(chatId))).toEqual([
        expect.objectContaining({
          answerable: true,
          away: { by: "Jeremy's iPhone", decision: "allowed" },
          status: "open",
        }),
      ]);
      expect((await openAsks(chatId))[0]).not.toHaveProperty("answered");
    });

    it("never takes a stale answer that arrives while it runs, and takes a fresh one", async () => {
      const { card, chatId, pantry, task } = await raised();
      const stale = await computer("Jeremy's iPhone", undefined, halfAnHourAgo);
      const fresh = await computer("MacBook Air");
      const stopWatcher = publisher.subscribe(
        "record.changed",
        ({ id, kind }) => {
          if (id === chatId && kind === "session") {
            driveAsks(chatId, context().workspaceRef).catch(() => undefined);
          }
        },
      );
      try {
        const sentBefore = sent.length;
        await on(stale, () => answer(chatId, card.id, "allowed"));
        await owner().catchUp(chatId);
        await driveAsks(chatId, context().workspaceRef);
        expect(await chatGrants(chatId)).toEqual([]);
        expect(wokenSince(sentBefore)).toEqual([]);

        await on(fresh, () => answer(chatId, card.id, "allowed"));
        await owner().catchUp(chatId);
        await driveAsks(chatId, context().workspaceRef);
        expect(await chatGrants(chatId)).toEqual([
          expect.objectContaining({ path: pantry }),
        ]);
        expect(wokenSince(sentBefore)).toEqual([
          { answer: ["allowed"], sessionId: task },
        ]);
      } finally {
        stopWatcher();
      }
    });

    // The app quit, or crashed, after taking an answer and before it woke
    // anyone, and comes back once the answer is stale: what was owed is
    // finished, and the askers read the answer with the person's next
    // message rather than starting work nobody is watching.
    it("finishes a stale answer it took before a crash, leaving a note that starts no turn", async () => {
      const { card, chatId, pantry, task } = await raised();
      const phone = await computer("Jeremy's iPhone", undefined, halfAnHourAgo);
      await on(phone, () => answer(chatId, card.id, "allowed"));
      await owner().catchUp(chatId);
      const given = (await owner().read(chatId)).chat.sessions
        .flatMap((session) => session.answers ?? [])
        .find((one) => one.ask === card.id);
      if (given?.given.kind !== "permission") {
        throw new Error("expected the phone's answer");
      }
      const { ask: _ask, given: what, ...ref } = given;
      await changeAsk(chatId, card.id, ({ ask }) => ({
        ...ask,
        stage: { answer: { ...ref, ...what }, is: "taken" },
      }));
      const sentBefore = sent.length;

      await driveOwedAsks(context().workspaceRef);

      expect(await chatGrants(chatId)).toEqual([
        expect.objectContaining({ path: pantry }),
      ]);
      expect(await openAsks(chatId)).toEqual([]);
      expect(sent.slice(sentBefore)).toEqual([]);
      const history = (await owner().read(chatId)).chat.sessions.find(
        ({ id }) => id === task,
      );
      expect(
        history?.messages.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "data-permissionAnswer"
              ? [{ answer: part.data.answer, ask: part.data.ask }]
              : [],
          ),
        ),
      ).toEqual([{ answer: "allowed", ask: card.id }]);
    });

    it("wakes nobody twice when it stopped between the note and saying so", async () => {
      const { card, chatId, task } = await raised();
      const phone = await computer("Jeremy's iPhone");
      await on(phone, () => answer(chatId, card.id, "allowed"));
      await owner().catchUp(chatId);
      await driveAsks(chatId, context().workspaceRef);
      const sentBefore = sent.length;
      // What a crash after the note left: the ask not marked woken.
      await changeAsk(chatId, card.id, ({ ask }) =>
        ask.stage.is === "closed"
          ? { ...ask, stage: { ...ask.stage, woken: false } }
          : undefined,
      );

      await driveAsks(chatId, context().workspaceRef);

      expect(wokenSince(sentBefore)).toEqual([]);
      const notes = (await owner().read(chatId)).chat.sessions
        .find(({ id }) => id === task)
        ?.messages.filter((message) =>
          message.parts.some((part) => part.type === "data-permissionAnswer"),
        );
      expect(notes).toHaveLength(1);
    });

    // A wake ahead of it in the same pass can take minutes finding the
    // chat's model; a session that asks meanwhile is still woken.
    it("keeps a session that joined while an earlier wake waited, when it takes the answer", async () => {
      const { chatId, own, task } = await chatWithTask();
      chatIdNow = chatId;
      await computer("Studio Mac", owner().device);
      // Asked first, so a pass reaches it first.
      const cellar = await recordAsk(
        { chatId, sessionId: own },
        "folder",
        "/Users/me/Cellar",
      );
      const pantry = await recordAsk(
        { chatId, sessionId: task },
        "folder",
        "/Users/me/Pantry",
      );
      const card = { id: pantry };
      // The cellar closed a moment ago and is owed its wake.
      await changeAsk(chatId, cellar, ({ ask }) => ({
        ...ask,
        stage: {
          closedAt: new Date(),
          is: "closed",
          outcome: {
            data: {
              answer: "allowed",
              kind: "folder",
              target: "/Users/me/Cellar",
            },
            kind: "permission",
          },
          woken: false,
        },
      }));
      const phone = await computer("Jeremy's iPhone");
      await on(phone, () => answer(chatId, card.id, "allowed"));
      await owner().catchUp(chatId);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let waiting = false;
      modelGate.wait = () => {
        waiting = true;
        return held;
      };
      const sentBefore = sent.length;
      try {
        const driving = driveAsks(chatId, context().workspaceRef);
        await vi.waitFor(() => {
          expect(waiting).toBe(true);
        });
        modelGate.wait = () => Promise.resolve();
        const late = await chatTaskFor(chatId, { title: "Count the jars" });
        await recordAsk(
          { chatId, sessionId: late },
          "folder",
          "/Users/me/Pantry",
        );
        release();
        await driving;

        expect(
          wokenSince(sentBefore).map(({ sessionId }) => sessionId),
        ).toEqual(expect.arrayContaining([own, task, late]));
      } finally {
        modelGate.wait = () => Promise.resolve();
        release();
      }
    });

    // The app quit between closing an ask and waking its askers, and comes
    // back later: the ask closed on no answer of anyone's (a sign-in that
    // finished, a look that got in), so only when it closed says the wake
    // is owed from before.
    it("leaves a note that starts no turn for a wake owed since before it started", async () => {
      const { card, chatId, pantry, task } = await raised();
      await changeAsk(chatId, card.id, ({ ask }) => ({
        ...ask,
        stage: {
          closedAt: new Date(Date.now() - 60 * 60 * 1000),
          is: "closed",
          outcome: {
            data: { answer: "allowed", kind: "folder", target: pantry },
            kind: "permission",
          },
          woken: false,
        },
      }));
      const sentBefore = sent.length;

      await driveOwedAsks(context().workspaceRef);

      expect(sent.slice(sentBefore)).toEqual([]);
      const notes = (await owner().read(chatId)).chat.sessions
        .find(({ id }) => id === task)
        ?.messages.filter((message) =>
          message.parts.some((part) => part.type === "data-permissionAnswer"),
        );
      expect(notes).toHaveLength(1);
    });

    it("takes a session another computer stopped off the card, waking nobody", async () => {
      const { card, chatId, task } = await raised();
      const phone = await computer("Jeremy's iPhone");
      await on(phone, () => closeAsksOf(chatId, task));
      expect(await on(phone, () => openAsks(chatId))).toEqual([]);
      const sentBefore = sent.length;

      await owner().catchUp(chatId);
      await driveAsks(chatId, context().workspaceRef);

      const session = (await owner().read(chatId)).chat.sessions.find(
        ({ id }) => id === sessionOfChat(chatId),
      );
      expect(session?.asks).toEqual([
        expect.objectContaining({
          id: card.id,
          stage: expect.objectContaining({
            is: "closed",
            outcome: { kind: "left" },
            woken: true,
          }),
        }),
      ]);
      expect(wokenSince(sentBefore)).toEqual([]);
    });
  });
});
