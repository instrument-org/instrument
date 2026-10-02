import { describe, expect, it } from "vitest";

import { migrateWindowStorage } from "./migrate-window-storage";

function storageOf(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    clear: () => {
      map.clear();
    },
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("migrateWindowStorage", () => {
  it("moves the window's stored addresses and small views to chats", () => {
    const storage = storageOf({
      "orchestrator.app-tabs.v1": JSON.stringify({
        tabs: [
          { pathname: "/orchestrator/threads/ses_01J9" },
          { pathname: "/orchestrator/tasks/book?thread=ses_01J9&tab=1" },
          { pathname: "/orchestrator/tasks?thread=ses_01J9" },
        ],
      }),
      "orchestrator.compose.v1": JSON.stringify([
        { kind: "thread", sessionId: "ses_01J9" },
      ]),
    });

    migrateWindowStorage(storage);

    expect(storage.getItem("studio.app-tabs.v1")).toBe(
      JSON.stringify({
        tabs: [
          { pathname: "/chats/ses_01J9" },
          { pathname: "/tasks/book?chat=ses_01J9&tab=1" },
          { pathname: "/tasks?chat=ses_01J9" },
        ],
      }),
    );
    expect(storage.getItem("studio.compose.v1")).toBe(
      JSON.stringify([{ kind: "chat", sessionId: "ses_01J9" }]),
    );
  });

  it("moves every screen out from under /orchestrator", () => {
    const tabs = (...pathnames: string[]) =>
      JSON.stringify({ tabs: pathnames.map((pathname) => ({ pathname })) });
    const storage = storageOf({
      "orchestrator.app-tabs.v1": tabs(
        "/orchestrator",
        "/orchestrator/",
        "/orchestrator?chat=ses_01J9",
        "/orchestrator/computer?path=%2FUsers%2Fme",
        "/orchestrator/web",
        "/orchestrator/website",
        "/orchestrator/ideas/landing-page",
        "/orchestrator/home",
        "/orchestrator/page?group=site%3A6f1c2a4e-9b1d-4c3e-8f00-1a2b3c4d5e6f",
        "/orchestrator/apps/notion",
        "/orchestrator/skills/create-page",
        "/orchestrator/release-notes",
      ),
    });

    migrateWindowStorage(storage);

    expect(storage.getItem("studio.app-tabs.v1")).toBe(
      tabs(
        "/chats",
        "/chats",
        "/chats?chat=ses_01J9",
        "/files?path=%2FUsers%2Fme",
        "/browser",
        "/orchestrator/website",
        "/discover/landing-page",
        "/new-tab",
        "/sites/6f1c2a4e-9b1d-4c3e-8f00-1a2b3c4d5e6f",
        "/apps/notion",
        "/skills/create-page",
        "/release-notes",
      ),
    );
  });

  it("leaves a web page's own address alone", () => {
    const pages = JSON.stringify([
      { url: "https://forum.example/view?thread=12" },
      { url: "https://docs.example/orchestrator/tasks" },
    ]);
    const storage = storageOf({ "orchestrator.visited-pages.v1": pages });

    migrateWindowStorage(storage);

    expect(storage.getItem("studio.visited-pages.v1")).toBe(pages);
  });

  it("changes nothing on a second run", () => {
    const value = JSON.stringify({ tabs: [{ pathname: "/chats/ses_01J9" }] });
    const storage = storageOf({ "studio.app-tabs.v1": value });

    migrateWindowStorage(storage);

    expect(storage.getItem("studio.app-tabs.v1")).toBe(value);
  });

  it("moves the window's keys to studio., dropping the classic window's", () => {
    const storage = storageOf({
      "orchestrator.inbox-open.v1": "true",
      "orchestrator.sidebar-width.v1": "420",
      "orchestrator.tabs.v8": "{}",
      "studio.sidebar-width.v1": "300",
      "studio.tabs.v1": "{}",
      "studio.zoom.v1": "1.25",
    });

    migrateWindowStorage(storage);

    expect(
      Object.fromEntries(
        Array.from({ length: storage.length }, (_, index) => {
          const key = storage.key(index) ?? "";
          return [key, storage.getItem(key)];
        }),
      ),
    ).toMatchInlineSnapshot(`
      {
        "studio.inbox-open.v1": "true",
        "studio.inbox-width.v1": "420",
        "studio.window-tabs.v8": "{}",
        "studio.zoom.v1": "1.25",
      }
    `);
  });

  it("keeps a value a migrated build already wrote under the new name", () => {
    const storage = storageOf({
      "orchestrator.inbox-open.v1": "false",
      "studio.inbox-open.v1": "true",
    });

    migrateWindowStorage(storage);

    expect(storage.getItem("studio.inbox-open.v1")).toBe("true");
    expect(storage.getItem("orchestrator.inbox-open.v1")).toBeNull();
  });

  it("leaves what is not the window's alone", () => {
    const value = JSON.stringify({
      pathname: "/orchestrator/threads/ses_01J9",
    });
    const storage = storageOf({ "studio.zoom.v1": value });

    migrateWindowStorage(storage);

    expect(storage.getItem("studio.zoom.v1")).toBe(value);
  });
});
