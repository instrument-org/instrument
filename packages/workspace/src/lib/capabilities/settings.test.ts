import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AppSetting, type AppSettings } from "../app-settings";
import {
  beginSettingChangeTracking,
  consumeSettingChanges,
  undoSettingChanges,
} from "../setting-changes";
import { beginTurn, withTurnContext } from "../turn-context";
import { getWorkspaceConfig } from "../workspace-config";
import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { settingsGet, settingsList, settingsSet } from "./settings";

vi.mock(import("../workspace-config"));

const key = {
  id: ChatIdSchema.parse("settings-chat"),
  sessionId: StoreId.newSessionId(),
};
let theme = "system";

const settings: AppSettings = {
  list: () =>
    Promise.resolve([
      {
        changeable: true,
        choices: [
          { label: "Dark", value: "dark" },
          { label: "System", value: "system" },
        ],
        detail: "The app's color scheme.",
        id: "theme",
        link: "instrument://settings/theme",
        title: "Theme",
        value: { label: theme, value: theme },
      },
      {
        changeable: false,
        detail: "Whether a history is kept.",
        id: "keep-history",
        link: "instrument://settings/keep-history",
        title: "Keep a history",
        value: { label: "On", value: "on" },
      },
    ] satisfies AppSetting[]),
  set: (_id, value) => {
    theme = value;
    return Promise.resolve();
  },
};

// The settings capabilities read nothing of the call's context.
const ctx = {} as Parameters<typeof settingsSet.run>[1];
const set = (id: string, value: string) => settingsSet.run({ id, value }, ctx);

beforeEach(() => {
  theme = "system";
  vi.mocked(getWorkspaceConfig).mockReturnValue({
    appSettings: settings,
  } as ReturnType<typeof getWorkspaceConfig>);
});

async function turn(work: () => Promise<unknown>) {
  beginTurn(key);
  beginSettingChangeTracking(key);
  await withTurnContext(key, work);
  return consumeSettingChanges(key);
}

describe("instrument settings", () => {
  it("lists what each setting is, its value and what it takes", async () => {
    expect(settingsList.text(await settingsList.run({}, ctx)))
      .toMatchInlineSnapshot(`
      "theme: Theme
        The app's color scheme.
        Now: system
        Takes: dark, system
        Link: [Theme](instrument://settings/theme)

      keep-history: Keep a history
        Whether a history is kept.
        Now: on
        The user changes this one themselves; link it.
        Link: [Keep a history](instrument://settings/keep-history)"
    `);
  });

  it("finds one whatever its case", async () => {
    expect((await settingsGet.run({ id: "Theme" }, ctx)).id).toBe("theme");
  });

  it.each([
    ["one not here", "permissions"],
    ["the user's own", "keep-history"],
  ])("refuses %s", async (_case, id) => {
    const said = await set(id, "off").catch((error: unknown) => error);
    expect(said).toBeInstanceOf(Error);
    expect(String(said)).toContain(
      id === "keep-history" ? "instrument://settings/keep-history" : "guide",
    );
    expect(theme).toBe("system");
  });

  it("keeps the value from before the turn, and drops what ends there", async () => {
    const changes = await turn(async () => {
      await set("theme", "light");
      await set("theme", "dark");
    });
    expect(changes).toMatchObject([
      { after: { value: "dark" }, before: { value: "system" }, id: "theme" },
    ]);
    theme = "system";
    expect(
      await turn(async () => {
        await set("theme", "dark");
        await set("theme", "system");
      }),
    ).toEqual([]);
  });

  it("goes back to the value the person set between two changes", async () => {
    const changes = await turn(async () => {
      await set("theme", "dark");
      theme = "light";
      await set("theme", "dark");
    });
    expect(changes[0]?.before.value).toBe("light");
  });

  it("undoes what still stands and skips what changed since", async () => {
    const changes = await turn(() => set("theme", "dark"));
    expect(await undoSettingChanges(changes)).toEqual({
      skipped: 0,
      undone: 1,
    });
    expect(theme).toBe("system");
    theme = "light";
    expect(await undoSettingChanges(changes)).toEqual({
      skipped: 1,
      undone: 0,
    });
    expect(theme).toBe("light");
  });
});
